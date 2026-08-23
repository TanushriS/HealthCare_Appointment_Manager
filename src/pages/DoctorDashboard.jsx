import React, { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { connectGoogleCalendar, syncAppointmentToCalendar } from '../services/googleCalendar'
import Modal from '../components/Modal'

export default function DoctorDashboard({ user, addToast }) {
  const [activeTab, setActiveTab] = useState('schedule')
  const [appointments, setAppointments] = useState([])
  const [leaves, setLeaves] = useState([])
  const [calendarSyncStatus, setCalendarSyncStatus] = useState(null)
  
  // Consultation Modal State
  const [isConsultModalOpen, setIsConsultModalOpen] = useState(false)
  const [activeApp, setActiveApp] = useState(null)
  const [clinicalNotes, setClinicalNotes] = useState('')
  const [prescriptions, setPrescriptions] = useState([{ name: '', dosage: '', frequency: 'Once daily', duration: '5 days' }])
  const [submittingConsult, setSubmittingConsult] = useState(false)

  // Leave Modal State
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false)
  const [leaveDate, setLeaveDate] = useState('')
  const [leaveReason, setLeaveReason] = useState('')

  useEffect(() => {
    fetchAppointments()
    fetchLeaves()
    checkCalendarSync()
  }, [])

  const fetchAppointments = async () => {
    // Fetch appointments assigned to the doctor, including symptom forms and pre-visit AI summaries
    const { data, error } = await supabase
      .from('appointments')
      .select(`
        id, slot_start, slot_end, status, patient_id,
        patient:profiles!appointments_patient_id_fkey(name, email, phone),
        symptom_forms(symptoms_text, severity, duration),
        pre_visit_summaries(urgency_level, chief_complaint, suggested_questions, status),
        post_visit_summaries(summary_text, status)
      `)
      .eq('doctor_id', user.id)
      .order('slot_start', { ascending: true })

    if (error) {
      console.error(error)
    } else {
      setAppointments(data || [])
    }
  }

  const fetchLeaves = async () => {
    const { data, error } = await supabase
      .from('doctor_leave_days')
      .select('*')
      .eq('doctor_id', user.id)
      .order('date', { ascending: true })
    if (!error) setLeaves(data || [])
  }

  const checkCalendarSync = async () => {
    const { data, error } = await supabase
      .from('user_oauth_tokens')
      .select('expiry_time')
      .eq('user_id', user.id)
      .single()
    
    if (data && !error) {
      setCalendarSyncStatus(new Date(data.expiry_time) > new Date() ? 'Linked' : 'Expired')
    } else {
      setCalendarSyncStatus('Not Linked')
    }
  }

  const handleOpenConsult = (app) => {
    setActiveApp(app)
    setClinicalNotes('')
    setPrescriptions([{ name: '', dosage: '', frequency: 'Once daily', duration: '5 days' }])
    setIsConsultModalOpen(true)
  }

  const handleAddPrescriptionRow = () => {
    setPrescriptions([...prescriptions, { name: '', dosage: '', frequency: 'Once daily', duration: '5 days' }])
  }

  const handleRemovePrescriptionRow = (index) => {
    setPrescriptions(prescriptions.filter((_, i) => i !== index))
  }

  const handlePrescriptionChange = (index, field, value) => {
    const updated = prescriptions.map((p, i) => {
      if (i === index) {
        return { ...p, [field]: value }
      }
      return p
    })
    setPrescriptions(updated)
  }

  const handleSubmitConsult = async (e) => {
    e.preventDefault()
    if (!clinicalNotes) {
      addToast('Please enter clinical notes', 'warning')
      return
    }

    setSubmittingConsult(true)
    try {
      // 1. Filter out empty prescriptions
      const validPrescriptions = prescriptions.filter(p => p.name.trim() !== '')

      // 2. Insert into visit_notes
      const { error: notesErr } = await supabase
        .from('visit_notes')
        .insert({
          appointment_id: activeApp.id,
          clinical_notes: clinicalNotes,
          prescription: validPrescriptions
        })

      if (notesErr) throw notesErr

      // 3. Update appointment status to 'completed'
      const { error: appErr } = await supabase
        .from('appointments')
        .update({ status: 'completed' })
        .eq('id', activeApp.id)

      if (appErr) throw appErr

      // 4. Trigger LLM post-visit summary call asynchronously (non-blocking)
      supabase.functions.invoke('llm-summaries', {
        body: { type: 'post_visit', appointmentId: activeApp.id }
      }).catch(err => console.error("Error triggering post-visit AI summary:", err))

      // 5. Send notification email (patient notification of completion)
      const { data: profile } = await supabase.from('profiles').select('email, name').eq('id', activeApp.patient_id).single()
      if (profile) {
        supabase.from('notifications_log').insert({
          appointment_id: activeApp.id,
          type: 'visit_completed',
          channel: 'email',
          status: 'pending',
          recipient_email: profile.email,
          subject: 'Your visit summary is ready',
          body: `Hello ${profile.name},\n\nYour visit with Dr. has been completed. Your clinical prescription and an AI-generated patient-friendly summary are now available on the portal.\n\nBest regards,\nMediCare Connect`
        }).then(({ data }) => {
          // Trigger email background send
          if (data && data[0]) {
             supabase.functions.invoke('notifications', { body: { notificationId: data[0].id } })
          }
        })
      }

      addToast('Consultation saved. AI summary generation triggered.', 'success')
      setIsConsultModalOpen(false)
      fetchAppointments()
    } catch (err) {
      addToast(err.message, 'error')
    } finally {
      setSubmittingConsult(false)
    }
  }

  const handleSaveLeave = async (e) => {
    e.preventDefault()
    if (!leaveDate) return

    try {
      const { error } = await supabase
        .from('doctor_leave_days')
        .insert({
          doctor_id: user.id,
          date: leaveDate,
          reason: leaveReason
        })

      if (error) {
        if (error.code === '23505') {
          throw new Error('You are already marked on leave for this date')
        }
        throw error
      }

      addToast('Leave marked. Patients booked on this day have been notified.', 'success')
      setIsLeaveModalOpen(false)
      setLeaveDate('')
      setLeaveReason('')
      fetchLeaves()
      fetchAppointments()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleDeleteLeave = async (id) => {
    try {
      const { error } = await supabase
        .from('doctor_leave_days')
        .delete()
        .eq('id', id)

      if (error) throw error
      addToast('Leave day removed', 'success')
      fetchLeaves()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleConnectCalendar = () => {
    connectGoogleCalendar(user.id)
  }

  const handleTriggerAISync = async (appId) => {
    addToast('Syncing calendar event...', 'info')
    const res = await syncAppointmentToCalendar('sync', appId)
    if (res?.error) {
      addToast(`Sync failed: ${res.error}`, 'error')
    } else {
      addToast('Google Calendar synced successfully!', 'success')
      fetchAppointments()
    }
  }

  return (
    <div className="main-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <div>
          <h1>Doctor Portal</h1>
          <p style={{ color: 'var(--text-muted)' }}>Review symptoms, manage leave calendar, and record prescriptions.</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn btn-secondary" onClick={handleConnectCalendar}>
            📅 Google Calendar ({calendarSyncStatus})
          </button>
          <button className="btn btn-primary" onClick={() => setIsLeaveModalOpen(true)}>
            🏖️ Set Leave Day
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '24px', gap: '16px' }}>
        <button 
          className={`btn ${activeTab === 'schedule' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('schedule')}
        >
          My Schedule
        </button>
        <button 
          className={`btn ${activeTab === 'leaves' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('leaves')}
        >
          Leaves log
        </button>
      </div>

      {/* Tab: Schedule */}
      {activeTab === 'schedule' && (
        <div>
          {appointments.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>No appointments booked yet.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {appointments.map((app) => (
                <div key={app.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                    <div>
                      <h3 style={{ fontSize: '1.2rem', marginBottom: '4px' }}>Patient: {app.patient?.name}</h3>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Email: {app.patient?.email} | Phone: {app.patient?.phone || 'N/A'}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: '700', color: '#fff' }}>{new Date(app.slot_start).toLocaleDateString()}</div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {new Date(app.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(app.slot_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                    {/* Symptoms Submitted */}
                    <div>
                      <h4 style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Patient Symptoms</h4>
                      {app.symptom_forms?.[0] ? (
                        <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                          <p style={{ fontStyle: 'italic', marginBottom: '8px' }}>"{app.symptom_forms[0].symptoms_text}"</p>
                          <div style={{ display: 'flex', gap: '10px' }}>
                            <span className={`badge badge-${app.symptom_forms[0].severity}`}>Severity: {app.symptom_forms[0].severity}</span>
                            <span className="badge badge-confirmed">Duration: {app.symptom_forms[0].duration}</span>
                          </div>
                        </div>
                      ) : (
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No symptoms submitted.</p>
                      )}
                    </div>

                    {/* AI Pre-visit Summary */}
                    <div>
                      <h4 style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginBottom: '8px' }}>AI Pre-visit Analysis</h4>
                      {app.pre_visit_summaries?.[0] ? (
                        <div style={{ background: 'rgba(37, 99, 235, 0.05)', padding: '12px', borderRadius: '8px', border: '1px dashed var(--primary)' }}>
                          {app.pre_visit_summaries[0].status === 'pending' && <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>⏳ AI pre-visit summary is pending...</p>}
                          {app.pre_visit_summaries[0].status === 'failed' && <p style={{ fontSize: '0.85rem', color: 'var(--danger)' }}>❌ AI generation failed.</p>}
                          {app.pre_visit_summaries[0].status === 'completed' && (
                            <>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <strong style={{ fontSize: '0.9rem' }}>Chief Complaint:</strong>
                                <span className={`badge badge-${app.pre_visit_summaries[0].urgency_level?.toLowerCase()}`}>
                                  {app.pre_visit_summaries[0].urgency_level} Urgency
                                </span>
                              </div>
                              <p style={{ fontSize: '0.85rem', marginBottom: '10px' }}>{app.pre_visit_summaries[0].chief_complaint}</p>
                              <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>Suggested Questions:</strong>
                              <ul style={{ fontSize: '0.8rem', paddingLeft: '16px' }}>
                                {app.pre_visit_summaries[0].suggested_questions?.map((q, idx) => (
                                  <li key={idx} style={{ color: 'var(--text-main)', marginBottom: '2px' }}>{q}</li>
                                ))}
                              </ul>
                            </>
                          )}
                        </div>
                      ) : (
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Waiting for patient symptom form submission.</p>
                      )}
                    </div>
                  </div>

                  {/* Actions Row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', paddingTop: '16px', marginTop: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className={`badge badge-${app.status}`}>{app.status}</span>
                      {calendarSyncStatus === 'Linked' && (
                        <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => handleTriggerAISync(app.id)}>
                          🔄 Sync Calendar
                        </button>
                      )}
                    </div>

                    {app.status === 'confirmed' && (
                      <button className="btn btn-primary" onClick={() => handleOpenConsult(app)}>
                        ✍️ Record Consultation & Prescription
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Leaves */}
      {activeTab === 'leaves' && (
        <div>
          <h2>My Leave Calendar</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>Mark leave dates. Conflicting appointments will automatically cancel.</p>
          
          <div className="table-container">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Reason</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {leaves.map((l) => (
                  <tr key={l.id}>
                    <td>{new Date(l.date).toLocaleDateString()}</td>
                    <td>{l.reason || 'No reason provided'}</td>
                    <td>
                      <button className="btn btn-danger" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => handleDeleteLeave(l.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {leaves.length === 0 && (
                  <tr>
                    <td colSpan="3" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No leaves recorded.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Consultation Modal */}
      <Modal
        isOpen={isConsultModalOpen}
        onClose={() => setIsConsultModalOpen(false)}
        title={`Record Consultation: ${activeApp?.patient?.name}`}
      >
        <form onSubmit={handleSubmitConsult}>
          <div className="form-group">
            <label className="form-label">Clinical Notes *</label>
            <textarea 
              className="form-input" 
              style={{ minHeight: '120px', fontFamily: 'inherit' }}
              placeholder="Record checkup summary, observations, advice, and instructions..."
              value={clinicalNotes}
              onChange={e => setClinicalNotes(e.target.value)}
              required
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', marginBottom: '8px' }}>
            <h3 style={{ fontSize: '1rem' }}>Prescriptions</h3>
            <button type="button" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8rem' }} onClick={handleAddPrescriptionRow}>
              ➕ Add Medicine
            </button>
          </div>

          <div className="prescription-builder">
            {prescriptions.map((p, idx) => (
              <div key={idx} className="prescription-row">
                <input 
                  type="text" 
                  className="form-input" 
                  style={{ padding: '8px' }}
                  placeholder="Medicine Name (e.g. Paracetamol)" 
                  value={p.name}
                  onChange={e => handlePrescriptionChange(idx, 'name', e.target.value)}
                />
                <input 
                  type="text" 
                  className="form-input" 
                  style={{ padding: '8px' }}
                  placeholder="Dosage (500mg)" 
                  value={p.dosage}
                  onChange={e => handlePrescriptionChange(idx, 'dosage', e.target.value)}
                />
                <select 
                  className="form-input" 
                  style={{ padding: '8px' }}
                  value={p.frequency}
                  onChange={e => handlePrescriptionChange(idx, 'frequency', e.target.value)}
                >
                  <option value="Once daily">Once daily</option>
                  <option value="Twice daily">Twice daily</option>
                  <option value="Three times daily">Three times daily</option>
                  <option value="Four times daily">Four times daily</option>
                  <option value="Every 4 hours">Every 4 hours</option>
                </select>
                <input 
                  type="text" 
                  className="form-input" 
                  style={{ padding: '8px' }}
                  placeholder="Duration (5 days)" 
                  value={p.duration}
                  onChange={e => handlePrescriptionChange(idx, 'duration', e.target.value)}
                />
                <button type="button" className="btn btn-danger" style={{ padding: '8px' }} onClick={() => handleRemovePrescriptionRow(idx)}>
                  🗑️
                </button>
              </div>
            ))}
            {prescriptions.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No medicines added. Prescription is optional.</p>
            )}
          </div>

          <div style={{ marginTop: '24px' }}>
            <button type="submit" className="btn btn-primary btn-full" disabled={submittingConsult}>
              {submittingConsult ? 'Saving Clinical Record...' : 'Complete Visit & Submit'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Leave Modal */}
      <Modal
        isOpen={isLeaveModalOpen}
        onClose={() => setIsLeaveModalOpen(false)}
        title="Apply For Leave"
      >
        <form onSubmit={handleSaveLeave}>
          <div className="form-group">
            <label className="form-label">Leave Date *</label>
            <input type="date" className="form-input" value={leaveDate} onChange={e => setLeaveDate(e.target.value)} required />
          </div>

          <div className="form-group">
            <label className="form-label">Reason</label>
            <input type="text" className="form-input" placeholder="Vacation, family medical, etc." value={leaveReason} onChange={e => setLeaveReason(e.target.value)} />
          </div>

          <div className="badge badge-high" style={{ width: '100%', display: 'block', textTransform: 'none', padding: '10px', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '20px' }}>
            ⚠️ <strong>Conflicting Bookings Note:</strong> Creating a leave will cancel confirmed bookings on that date.
          </div>

          <button type="submit" className="btn btn-danger btn-full">
            Record Leave Day
          </button>
        </form>
      </Modal>
    </div>
  )
}

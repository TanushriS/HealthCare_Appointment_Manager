import React, { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { connectGoogleCalendar, syncAppointmentToCalendar } from '../services/googleCalendar'
import Modal from '../components/Modal'

export default function PatientDashboard({ user, addToast }) {
  const [activeTab, setActiveTab] = useState('book')
  const [doctors, setDoctors] = useState([])
  const [specialisations, setSpecialisations] = useState([])
  const [selectedSpec, setSelectedSpec] = useState('')
  const [myAppointments, setMyAppointments] = useState([])
  const [calendarSyncStatus, setCalendarSyncStatus] = useState(null)

  // Booking Flow state
  const [selectedDoctor, setSelectedDoctor] = useState(null)
  const [bookingDate, setBookingDate] = useState('')
  const [availableSlots, setAvailableSlots] = useState([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState(null) // { start, end }
  const [heldAppointmentId, setHeldAppointmentId] = useState(null)
  const [holdTimer, setHoldTimer] = useState(0)

  // Symptom form state
  const [isSymptomModalOpen, setIsSymptomModalOpen] = useState(false)
  const [symptomsText, setSymptomsText] = useState('')
  const [severity, setSeverity] = useState('medium')
  const [duration, setDuration] = useState('')
  const [submittingBooking, setSubmittingBooking] = useState(false)

  // AI view state
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false)
  const [selectedAppSummary, setSelectedAppSummary] = useState(null)

  useEffect(() => {
    fetchDoctors()
    fetchMyAppointments()
    checkCalendarSync()
  }, [])

  // Manage checkout hold countdown timer
  useEffect(() => {
    if (holdTimer <= 0) {
      if (heldAppointmentId) {
        handleReleaseHold()
      }
      return
    }
    const interval = setInterval(() => {
      setHoldTimer(prev => prev - 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [holdTimer, heldAppointmentId])

  const fetchDoctors = async () => {
    const { data, error } = await supabase
      .from('doctor_profiles')
      .select(`
        user_id, specialisation, slot_duration, active,
        profile:profiles!doctor_profiles_user_id_fkey(name, email)
      `)
      .eq('active', true)

    if (!error && data) {
      setDoctors(data)
      const specs = [...new Set(data.map(d => d.specialisation))]
      setSpecialisations(specs)
    }
  }

  const fetchMyAppointments = async () => {
    const { data, error } = await supabase
      .from('appointments')
      .select(`
        id, slot_start, slot_end, status, created_at,
        doctor:profiles!appointments_doctor_id_fkey(name),
        symptom_forms(symptoms_text, severity, duration),
        pre_visit_summaries(urgency_level, chief_complaint, suggested_questions),
        visit_notes(clinical_notes, prescription),
        post_visit_summaries(summary_text, medication_schedule, follow_up_steps, status)
      `)
      .eq('patient_id', user.id)
      .order('slot_start', { ascending: false })

    if (!error) setMyAppointments(data || [])
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

  // Load available slots dynamically based on selected doctor and date
  const loadAvailableSlots = async (doctor, dateStr) => {
    if (!doctor || !dateStr) return
    setLoadingSlots(true)
    setSelectedSlot(null)

    try {
      const selectedDate = new Date(dateStr)
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
      const dayOfWeek = days[selectedDate.getDay()]

      // 1. Get working hours for the selected day
      const workingHours = doctor.working_hours?.[dayOfWeek]
      if (!workingHours) {
        setAvailableSlots([])
        addToast('Doctor does not work on this day of the week.', 'warning')
        return
      }

      // 2. Check if doctor is on leave
      const { data: leaves, error: lErr } = await supabase
        .from('doctor_leave_days')
        .select('*')
        .eq('doctor_id', doctor.user_id)
        .eq('date', dateStr)

      if (lErr) throw lErr
      if (leaves && leaves.length > 0) {
        setAvailableSlots([])
        addToast('Doctor is on leave on this date.', 'warning')
        return
      }

      // 3. Get existing non-cancelled bookings (confirmed, completed, and active holds) for this date
      const startOfDay = new Date(dateStr + 'T00:00:00Z').toISOString()
      const endOfDay = new Date(dateStr + 'T23:59:59Z').toISOString()

      const { data: existingBookings, error: bErr } = await supabase
        .from('appointments')
        .select('slot_start, slot_end, status, held_until')
        .eq('doctor_id', doctor.user_id)
        .neq('status', 'cancelled')
        .gte('slot_start', startOfDay)
        .lte('slot_start', endOfDay)

      if (bErr) throw bErr

      // Filter out holds that have expired
      const activeBookings = (existingBookings || []).filter(b => {
        if (b.status === 'held') {
          return new Date(b.held_until) > new Date()
        }
        return true
      })

      // 4. Generate all slots from working hours start to end
      const slots = []
      const [startHour, startMin] = workingHours.start.split(':').map(Number)
      const [endHour, endMin] = workingHours.end.split(':').map(Number)
      const slotDuration = doctor.slot_duration || 30

      let currentSlotStart = new Date(dateStr + `T${String(startHour).padStart(2,'0')}:${String(startMin).padStart(2,'0')}:00`)
      const limitTime = new Date(dateStr + `T${String(endHour).padStart(2,'0')}:${String(endMin).padStart(2,'0')}:00`)

      while (currentSlotStart < limitTime) {
        const currentSlotEnd = new Date(currentSlotStart.getTime() + slotDuration * 60 * 1000)
        if (currentSlotEnd > limitTime) break

        // Format times to ISO Strings
        const slotStartISO = currentSlotStart.toISOString()
        const slotEndISO = currentSlotEnd.toISOString()

        // Check if slot overlaps with any active bookings
        const isBooked = activeBookings.some(b => {
          const bStart = new Date(b.slot_start).toISOString()
          return bStart === slotStartISO
        })

        // Also prevent booking slots in the past
        const isPast = new Date(slotStartISO) < new Date()

        slots.push({
          start: slotStartISO,
          end: slotEndISO,
          timeLabel: currentSlotStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          disabled: isBooked || isPast
        })

        currentSlotStart = currentSlotEnd
      }

      setAvailableSlots(slots)
    } catch (err) {
      addToast(err.message, 'error')
    } finally {
      setLoadingSlots(false)
    }
  }

  // Triggered when a patient clicks a slot button: initiates a hold
  const handleInitiateHold = async (slot) => {
    if (heldAppointmentId) {
      // Release previous hold if clicked a new one
      await handleReleaseHold()
    }

    try {
      const heldUntil = new Date(Date.now() + 3 * 60 * 1000).toISOString() // 3-minute hold
      
      // Perform DB write to lock the slot
      const { data, error } = await supabase
        .from('appointments')
        .insert({
          patient_id: user.id,
          doctor_id: selectedDoctor.user_id,
          slot_start: slot.start,
          slot_end: slot.end,
          status: 'held',
          held_until: heldUntil
        })
        .select('id')
        .single()

      if (error) {
        // Code 23505 is Postgres unique constraint error (double-booking prevention index)
        if (error.code === '23505') {
          throw new Error('This slot was just selected by another patient. Please choose a different time.')
        }
        throw error
      }

      setHeldAppointmentId(data.id)
      setSelectedSlot(slot)
      setSymptomsText('')
      setSeverity('medium')
      setDuration('')
      setHoldTimer(180) // 3 minutes = 180 seconds countdown
      setIsSymptomModalOpen(true)
    } catch (err) {
      addToast(err.message, 'error')
      loadAvailableSlots(selectedDoctor, bookingDate) // Reload slots
    }
  }

  // Releases a slot hold if cancelled or timeout occurs
  const handleReleaseHold = async () => {
    if (!heldAppointmentId) return
    const appId = heldAppointmentId
    setHeldAppointmentId(null)
    setHoldTimer(0)
    setSelectedSlot(null)
    setIsSymptomModalOpen(false)

    try {
      // Update appointment status to 'cancelled' so the index releases the slot
      await supabase
        .from('appointments')
        .update({ status: 'cancelled' })
        .eq('id', appId)

      addToast('Slot hold released.', 'info')
      if (selectedDoctor && bookingDate) {
        loadAvailableSlots(selectedDoctor, bookingDate)
      }
    } catch (err) {
      console.error("Failed to release hold", err)
    }
  }

  // Finalizes the booking: submits symptom form + confirms appointment status
  const handleConfirmBooking = async (e) => {
    e.preventDefault()
    if (!symptomsText || !duration) {
      addToast('Please fill in symptom details', 'warning')
      return
    }

    setSubmittingBooking(true)
    try {
      // 1. Write to symptom_forms
      const { error: symErr } = await supabase
        .from('symptom_forms')
        .insert({
          appointment_id: heldAppointmentId,
          symptoms_text: symptomsText,
          severity,
          duration
        })

      if (symErr) throw symErr

      // 2. Change appointment status to confirmed (removing held_until limit)
      const { error: appErr } = await supabase
        .from('appointments')
        .update({
          status: 'confirmed',
          held_until: null
        })
        .eq('id', heldAppointmentId)

      if (appErr) throw appErr

      const appointmentId = heldAppointmentId
      setHeldAppointmentId(null)
      setHoldTimer(0)
      setIsSymptomModalOpen(false)

      addToast('Appointment booked successfully! AI pre-visit summary is generating...', 'success')

      // 3. Invoke LLM pre-visit summary function in background (asynchronously)
      supabase.functions.invoke('llm-summaries', {
        body: { type: 'pre_visit', appointmentId }
      }).catch(err => console.error("Error generating pre-visit summary:", err))

      // 4. Send Confirmation Email (inserts into notifications_log)
      const { data: docProfile } = await supabase.from('profiles').select('name').eq('id', selectedDoctor.user_id).single()
      supabase.from('notifications_log').insert({
        appointment_id: appointmentId,
        type: 'booking_confirmation',
        channel: 'email',
        status: 'pending',
        recipient_email: user.email,
        subject: 'Appointment Booked - MediCare Connect',
        body: `Hello,\n\nYour appointment with Dr. ${docProfile?.name || 'Doctor'} has been confirmed for ${new Date(selectedSlot.start).toLocaleDateString()} at ${new Date(selectedSlot.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.\n\nThank you for choosing MediCare Connect!`
      }).then(({ data }) => {
        // Trigger notification edge function send
        if (data && data[0]) {
          supabase.functions.invoke('notifications', { body: { notificationId: data[0].id } })
        }
      })

      // 5. Trigger Google Calendar Sync if linked
      if (calendarSyncStatus === 'Linked') {
        syncAppointmentToCalendar('create', appointmentId)
          .then((res) => {
            if (res && res.error) {
              addToast(`Google Calendar Sync failed: ${res.error}`, 'warning')
            } else {
              addToast('Successfully synced to Google Calendar!', 'success')
            }
          })
      }

      fetchMyAppointments()
      setSelectedSlot(null)
      setSelectedDoctor(null)
      setBookingDate('')
    } catch (err) {
      addToast(err.message, 'error')
    } finally {
      setSubmittingBooking(false)
    }
  }

  const handleCancelAppointment = async (appId) => {
    if (!window.confirm('Are you sure you want to cancel this appointment?')) return

    try {
      const { error } = await supabase
        .from('appointments')
        .update({ status: 'cancelled' })
        .eq('id', appId)

      if (error) throw error

      addToast('Appointment cancelled successfully.', 'success')

      // Trigger Google Calendar Delete
      if (calendarSyncStatus === 'Linked') {
        syncAppointmentToCalendar('delete', appId)
      }

      fetchMyAppointments()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleConnectCalendar = () => {
    connectGoogleCalendar(user.id)
  }

  const filteredDoctors = doctors.filter(d => {
    if (selectedSpec && d.specialisation !== selectedSpec) return false
    return true
  })

  return (
    <div className="main-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <div>
          <h1>Patient Portal</h1>
          <p style={{ color: 'var(--text-muted)' }}>Search doctors, book time slots, and view AI visit summaries.</p>
        </div>
        <button className="btn btn-secondary" onClick={handleConnectCalendar}>
          📅 Google Calendar ({calendarSyncStatus})
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '24px', gap: '16px' }}>
        <button 
          className={`btn ${activeTab === 'book' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('book')}
        >
          Book Appointment
        </button>
        <button 
          className={`btn ${activeTab === 'my-appointments' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('my-appointments')}
        >
          My Appointments ({myAppointments.length})
        </button>
      </div>

      {/* Tab: Book Appointment */}
      {activeTab === 'book' && (
        <div style={{ display: 'grid', gridTemplateColumns: selectedDoctor ? '1fr 1fr' : '1fr', gap: '30px' }}>
          
          {/* Doctor List Panel */}
          <div>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '16px' }}>Find a Doctor</h2>
            
            <div className="form-group" style={{ maxWidth: '300px' }}>
              <label className="form-label">Specialisation</label>
              <select className="form-input" value={selectedSpec} onChange={e => setSelectedSpec(e.target.value)}>
                <option value="">All Specialisations</option>
                {specialisations.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {filteredDoctors.map((doc) => (
                <div 
                  key={doc.user_id} 
                  className={`card ${selectedDoctor?.user_id === doc.user_id ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedDoctor(doc)
                    setBookingDate('')
                    setAvailableSlots([])
                  }}
                  style={{ cursor: 'pointer', borderLeft: selectedDoctor?.user_id === doc.user_id ? '4px solid var(--primary)' : '1px solid var(--border-color)' }}
                >
                  <h3 style={{ fontSize: '1.1rem', marginBottom: '4px' }}>Dr. {doc.profile?.name}</h3>
                  <p style={{ fontSize: '0.85rem', color: 'var(--primary-hover)', fontWeight: '600', marginBottom: '8px' }}>{doc.specialisation}</p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Slot Duration: {doc.slot_duration} minutes</p>
                </div>
              ))}
            </div>
          </div>

          {/* Slots Selector Panel */}
          {selectedDoctor && (
            <div className="card">
              <h2 style={{ fontSize: '1.25rem', marginBottom: '16px' }}>Select Slot: Dr. {selectedDoctor.profile?.name}</h2>
              
              <div className="form-group">
                <label className="form-label">Select Date</label>
                <input 
                  type="date" 
                  className="form-input" 
                  min={new Date().toISOString().split('T')[0]}
                  value={bookingDate} 
                  onChange={e => {
                    setBookingDate(e.target.value)
                    loadAvailableSlots(selectedDoctor, e.target.value)
                  }}
                />
              </div>

              {loadingSlots ? (
                <p>Checking slot availability...</p>
              ) : bookingDate ? (
                <div>
                  <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '10px' }}>Available Slots</h4>
                  {availableSlots.length === 0 ? (
                    <p style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>No slots available for this day. Doctors may be on leave or fully booked.</p>
                  ) : (
                    <div className="slots-grid">
                      {availableSlots.map((slot, idx) => (
                        <button
                          key={idx}
                          className={`slot-btn ${slot.disabled ? 'disabled' : ''}`}
                          disabled={slot.disabled}
                          onClick={() => handleInitiateHold(slot)}
                        >
                          {slot.timeLabel}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)' }}>Please select a date to view available time slots.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab: My Appointments */}
      {activeTab === 'my-appointments' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {myAppointments.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>You have no appointments yet.</p>
          ) : (
            myAppointments.map(app => (
              <div key={app.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                  <div>
                    <h3 style={{ fontSize: '1.2rem' }}>Dr. {app.doctor?.name}</h3>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {new Date(app.slot_start).toLocaleDateString()} at {new Date(app.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span className={`badge badge-${app.status}`}>{app.status}</span>
                    
                    {app.status === 'confirmed' && (
                      <button 
                        className="btn btn-danger" 
                        style={{ padding: '6px 12px', fontSize: '0.8rem' }} 
                        onClick={() => handleCancelAppointment(app.id)}
                      >
                        Cancel
                      </button>
                    )}

                    {app.status === 'completed' && app.post_visit_summaries?.[0] && (
                      <button 
                        className="btn btn-primary" 
                        style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                        onClick={() => {
                          setSelectedAppSummary(app)
                          setIsSummaryModalOpen(true)
                        }}
                      >
                        📄 View Clinical & AI Summary
                      </button>
                    )}
                  </div>
                </div>

                {app.status === 'completed' && !app.post_visit_summaries?.[0] && (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>⏳ AI-friendly visit summary is pending...</p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Symptom checkout modal */}
      <Modal
        isOpen={isSymptomModalOpen}
        onClose={handleReleaseHold}
        title="Patient Intake & Symptom Form"
      >
        <div style={{ marginBottom: '16px', background: 'var(--primary-glow)', padding: '10px', borderRadius: '8px', border: '1px solid var(--primary)', fontSize: '0.85rem' }}>
          ⏳ Complete checkout within <strong>{Math.floor(holdTimer / 60)}:{(holdTimer % 60).toString().padStart(2,'0')}</strong> or the slot hold will be released.
        </div>

        <form onSubmit={handleConfirmBooking}>
          <div className="form-group">
            <label className="form-label">Symptom Description *</label>
            <textarea 
              className="form-input" 
              style={{ minHeight: '100px', fontFamily: 'inherit' }}
              placeholder="Describe what you are feeling, chief complaints, trigger events..."
              value={symptomsText}
              onChange={e => setSymptomsText(e.target.value)}
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Severity *</label>
              <select className="form-input" value={severity} onChange={e => setSeverity(e.target.value)} required>
                <option value="low">Low (Mild, manageable)</option>
                <option value="medium">Medium (Uncomfortable)</option>
                <option value="high">High (Severe pain, urgent)</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Duration *</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="e.g. 3 days, 2 weeks" 
                value={duration}
                onChange={e => setDuration(e.target.value)}
                required
              />
            </div>
          </div>

          <div style={{ marginTop: '20px' }}>
            <button type="submit" className="btn btn-primary btn-full" disabled={submittingBooking}>
              {submittingBooking ? 'Confirming Appointment...' : 'Confirm & Book Appointment'}
            </button>
          </div>
        </form>
      </Modal>

      {/* View Clinical Summary Modal */}
      <Modal
        isOpen={isSummaryModalOpen}
        onClose={() => setIsSummaryModalOpen(false)}
        title="Consultation Summary & Prescription"
      >
        {selectedAppSummary && (
          <div>
            <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '16px', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '1.1rem' }}>Dr. {selectedAppSummary.doctor?.name}</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Date: {new Date(selectedAppSummary.slot_start).toLocaleDateString()} at {new Date(selectedAppSummary.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>

            {/* AI Patient Summary */}
            <div style={{ background: 'rgba(16, 185, 129, 0.05)', border: '1px dashed var(--success)', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
              <h4 style={{ color: 'var(--success)', marginBottom: '8px', fontSize: '1rem' }}>✨ AI Patient-Friendly Summary</h4>
              <p style={{ fontSize: '0.9rem', marginBottom: '12px' }}>{selectedAppSummary.post_visit_summaries[0].summary_text}</p>
              
              <h4 style={{ color: 'var(--success)', marginBottom: '4px', fontSize: '0.9rem' }}>💊 Suggested Medication Schedule</h4>
              <p style={{ fontSize: '0.85rem', marginBottom: '12px', whiteSpace: 'pre-wrap' }}>{selectedAppSummary.post_visit_summaries[0].medication_schedule}</p>

              <h4 style={{ color: 'var(--success)', marginBottom: '4px', fontSize: '0.9rem' }}>🏃 Follow-up Steps</h4>
              <p style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{selectedAppSummary.post_visit_summaries[0].follow_up_steps}</p>
            </div>

            {/* Prescription details */}
            <div style={{ marginBottom: '20px' }}>
              <h4 style={{ marginBottom: '8px', fontSize: '1rem' }}>Rx Prescriptions</h4>
              {selectedAppSummary.visit_notes?.prescription && selectedAppSummary.visit_notes.prescription.length > 0 ? (
                <div className="table-container" style={{ marginTop: '8px' }}>
                  <table className="custom-table">
                    <thead>
                      <tr>
                        <th>Medicine</th>
                        <th>Dosage</th>
                        <th>Frequency</th>
                        <th>Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedAppSummary.visit_notes.prescription.map((rx, idx) => (
                        <tr key={idx}>
                          <td><strong>{rx.name}</strong></td>
                          <td>{rx.dosage}</td>
                          <td>{rx.frequency}</td>
                          <td>{rx.duration}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No prescription medications noted.</p>
              )}
            </div>

            {/* Clinical Notes */}
            <div>
              <h4 style={{ marginBottom: '6px', fontSize: '1rem', color: 'var(--text-muted)' }}>Original Clinical Notes</h4>
              <p style={{ fontSize: '0.85rem', padding: '12px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: '8px', whiteSpace: 'pre-wrap' }}>
                {selectedAppSummary.visit_notes?.clinical_notes}
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

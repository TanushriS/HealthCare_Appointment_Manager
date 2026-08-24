import React, { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import Modal from '../components/Modal'

const INITIAL_WORKING_HOURS = {
  monday: { enabled: true, start: '09:00', end: '17:00' },
  tuesday: { enabled: true, start: '09:00', end: '17:00' },
  wednesday: { enabled: true, start: '09:00', end: '17:00' },
  thursday: { enabled: true, start: '09:00', end: '17:00' },
  friday: { enabled: true, start: '09:00', end: '17:00' },
  saturday: { enabled: false, start: '09:00', end: '13:00' },
  sunday: { enabled: false, start: '09:00', end: '13:00' }
}

export default function AdminDashboard({ addToast, activeTab: propActiveTab, setActiveTab: propSetActiveTab }) {
  const [localActiveTab, setLocalActiveTab] = useState('doctors')
  const activeTab = propActiveTab || localActiveTab
  const setActiveTab = propSetActiveTab || setLocalActiveTab

  const [doctors, setDoctors] = useState([])
  const [appointments, setAppointments] = useState([])
  const [notifications, setNotifications] = useState([])
  
  // Doctor form state
  const [isDoctorModalOpen, setIsDoctorModalOpen] = useState(false)
  const [editingDoctor, setEditingDoctor] = useState(null)
  const [docName, setDocName] = useState('')
  const [docEmail, setDocEmail] = useState('')
  const [docPassword, setDocPassword] = useState('')
  const [docPhone, setDocPhone] = useState('')
  const [docSpec, setDocSpec] = useState('')
  const [docDuration, setDocDuration] = useState(30)
  const [workingHours, setWorkingHours] = useState(INITIAL_WORKING_HOURS)
  const [loadingAction, setLoadingAction] = useState(false)

  // Leave form state
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false)
  const [leaveDoctorId, setLeaveDoctorId] = useState('')
  const [leaveDate, setLeaveDate] = useState('')
  const [leaveReason, setLeaveReason] = useState('')

  // Filters for appointments
  const [filterDoc, setFilterDoc] = useState('')
  const [filterPatient, setFilterPatient] = useState('')
  const [filterDate, setFilterDate] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  useEffect(() => {
    fetchDoctors()
    fetchAppointments()
    fetchNotifications()
  }, [])

  const fetchDoctors = async () => {
    try {
      const { data, error } = await supabase
        .from('doctor_profiles')
        .select(`
          user_id, specialisation, slot_duration, active, working_hours,
          profile:profiles!doctor_profiles_user_id_fkey(name, email, phone)
        `)
      if (error) {
        // Fallback without explicit foreign key constraint name
        const { data: fbData, error: fbError } = await supabase
          .from('doctor_profiles')
          .select(`
            user_id, specialisation, slot_duration, active, working_hours,
            profile:profiles(name, email, phone)
          `)
        if (!fbError && fbData) {
          setDoctors(fbData)
          return
        }
        console.error("Error fetching doctors:", error || fbError)
      } else {
        setDoctors(data || [])
      }
    } catch (err) {
      console.error("fetchDoctors exception:", err)
    }
  }

  const fetchAppointments = async () => {
    try {
      const { data, error } = await supabase
        .from('appointments')
        .select(`
          id, slot_start, slot_end, status,
          patient:profiles!appointments_patient_id_fkey(name, email),
          doctor:profiles!appointments_doctor_id_fkey(name)
        `)
        .order('slot_start', { ascending: false })
      if (error) {
        // Fallback without explicit foreign key constraint names
        const { data: fbData, error: fbError } = await supabase
          .from('appointments')
          .select(`
            id, slot_start, slot_end, status,
            patient:profiles(name, email),
            doctor:profiles(name)
          `)
          .order('slot_start', { ascending: false })
        if (!fbError && fbData) {
          setAppointments(fbData)
          return
        }
        console.error("Error fetching appointments:", error || fbError)
      } else {
        setAppointments(data || [])
      }
    } catch (err) {
      console.error("fetchAppointments exception:", err)
    }
  }

  const fetchNotifications = async () => {
    try {
      const { data, error } = await supabase
        .from('notifications_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)
      if (!error) setNotifications(data || [])
    } catch (err) {
      console.error("fetchNotifications exception:", err)
    }
  }

  const handleOpenDoctorCreate = () => {
    setEditingDoctor(null)
    setDocName('')
    setDocEmail('')
    setDocPassword('')
    setDocPhone('')
    setDocSpec('')
    setDocDuration(30)
    setWorkingHours(INITIAL_WORKING_HOURS)
    setIsDoctorModalOpen(true)
  }

  const handleOpenDoctorEdit = (doc) => {
    setEditingDoctor(doc)
    setDocName(doc.profile?.name || '')
    setDocEmail(doc.profile?.email || '')
    setDocPassword('') // Keep password blank unless changing
    setDocPhone(doc.profile?.phone || '')
    setDocSpec(doc.specialisation || '')
    setDocDuration(doc.slot_duration || 30)
    
    // Parse working hours safely
    const parsedHours = {}
    const docHours = (doc.working_hours && typeof doc.working_hours === 'object') ? doc.working_hours : {}
    Object.keys(INITIAL_WORKING_HOURS).forEach(day => {
      if (docHours[day]) {
        parsedHours[day] = {
          enabled: true,
          start: docHours[day].start || '09:00',
          end: docHours[day].end || '17:00'
        }
      } else {
        parsedHours[day] = { enabled: false, start: '09:00', end: '17:00' }
      }
    })
    setWorkingHours(parsedHours)
    setIsDoctorModalOpen(true)
  }

  const handleSaveDoctor = async (e) => {
    e.preventDefault()
    setLoadingAction(true)

    // Formulate working hours json
    const finalHours = {}
    Object.keys(workingHours).forEach(day => {
      if (workingHours[day].enabled) {
        finalHours[day] = {
          start: workingHours[day].start,
          end: workingHours[day].end
        }
      }
    })

    try {
      if (editingDoctor) {
        // Edit doctor profile
        try {
          const { data, error } = await supabase.functions.invoke('manage-doctors', {
            body: {
              action: 'update',
              doctorId: editingDoctor.user_id,
              name: docName,
              phone: docPhone,
              specialisation: docSpec,
              workingHours: finalHours,
              slotDuration: parseInt(docDuration)
            }
          })
          if (error || !data?.success) throw error || new Error(data?.error)
        } catch (efErr) {
          console.warn("Edge function manage-doctors unavailable, using direct DB update:", efErr.message)
          await supabase.from('profiles').update({ name: docName, phone: docPhone }).eq('id', editingDoctor.user_id)
          await supabase.from('doctor_profiles').upsert({
            user_id: editingDoctor.user_id,
            specialisation: docSpec,
            working_hours: finalHours,
            slot_duration: parseInt(docDuration)
          })
        }
        addToast('Doctor profile updated successfully', 'success')
      } else {
        // Create new doctor profile
        try {
          const { data, error } = await supabase.functions.invoke('manage-doctors', {
            body: {
              action: 'create',
              name: docName,
              email: docEmail,
              password: docPassword,
              phone: docPhone,
              specialisation: docSpec,
              workingHours: finalHours,
              slotDuration: parseInt(docDuration)
            }
          })
          if (error || !data?.success) throw error || new Error(data?.error)
        } catch (efErr) {
          console.warn("Edge function manage-doctors unavailable, using direct DB creation:", efErr.message)
          let newDocId = null
          const signUpRes = await supabase.auth.signUp({
            email: docEmail,
            password: docPassword || 'DoctorPass123!',
            options: { data: { name: docName, role: 'doctor' } }
          })

          if (signUpRes.data?.user?.id) {
            newDocId = signUpRes.data.user.id
          } else {
            // If signup returned error or user already exists, check existing profiles
            const { data: existingProf } = await supabase.from('profiles').select('id').eq('email', docEmail).maybeSingle()
            if (existingProf?.id) {
              newDocId = existingProf.id
            } else {
              throw new Error(signUpRes.error?.message || "Failed to create authentication user for doctor")
            }
          }

          const { error: pErr } = await supabase.from('profiles').upsert({
            id: newDocId,
            name: docName,
            email: docEmail,
            phone: docPhone,
            role: 'doctor'
          })
          if (pErr) throw pErr

          const { error: dpErr } = await supabase.from('doctor_profiles').upsert({
            user_id: newDocId,
            specialisation: docSpec,
            working_hours: finalHours,
            slot_duration: parseInt(docDuration),
            active: true
          })
          if (dpErr) throw dpErr
        }
        addToast('Doctor profile created successfully', 'success')
      }
      setIsDoctorModalOpen(false)
      fetchDoctors()
    } catch (err) {
      addToast(err.message || 'Operation failed', 'error')
    } finally {
      setLoadingAction(false)
    }
  }

  const handleToggleActive = async (doctorId, currentActive) => {
    try {
      try {
        const { data, error } = await supabase.functions.invoke('manage-doctors', {
          body: {
            action: 'toggle_active',
            doctorId,
            active: !currentActive
          }
        })
        if (error) throw error
      } catch (efErr) {
        console.warn("Edge function manage-doctors unavailable, using direct DB toggle:", efErr.message)
        const { error: toggleErr } = await supabase.from('doctor_profiles').update({
          active: !currentActive
        }).eq('user_id', doctorId)
        if (toggleErr) throw toggleErr
      }
      addToast(`Doctor profile ${!currentActive ? 'activated' : 'deactivated'} successfully`, 'success')
      fetchDoctors()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleSaveLeave = async (e) => {
    e.preventDefault()
    if (!leaveDoctorId || !leaveDate) {
      addToast('Please fill in doctor and date fields', 'warning')
      return
    }

    try {
      const { error } = await supabase
        .from('doctor_leave_days')
        .insert({
          doctor_id: leaveDoctorId,
          date: leaveDate,
          reason: leaveReason
        })

      if (error) {
        if (error.code === '23505') {
          throw new Error('This doctor is already marked on leave for this date')
        }
        throw error
      }

      addToast('Leave marked successfully. Conflicting appointments cancelled.', 'success')
      setIsLeaveModalOpen(false)
      setLeaveDoctorId('')
      setLeaveDate('')
      setLeaveReason('')
      fetchAppointments()
      fetchNotifications()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleTriggerBackgroundJobs = async () => {
    try {
      addToast('Triggering background job...', 'info')
      const { data, error } = await supabase.functions.invoke('background-jobs')
      if (error) throw error
      addToast(`Cron completed. Released Holds: ${data?.results?.expiredHolds?.count || 0}, Retries: ${data?.results?.notificationRetries?.retried || 0}`, 'success')
      fetchAppointments()
      fetchNotifications()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const filteredAppointments = (appointments || []).filter(app => {
    if (!app) return false
    if (filterDoc && !app.doctor?.name?.toLowerCase().includes(filterDoc.toLowerCase())) return false
    if (filterPatient && !app.patient?.name?.toLowerCase().includes(filterPatient.toLowerCase())) return false
    if (filterDate && !(app.slot_start && String(app.slot_start).startsWith(filterDate))) return false
    if (filterStatus && app.status !== filterStatus) return false
    return true
  })

  return (
    <div className="main-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <div>
          <h1>Administrator Dashboard</h1>
          <p style={{ color: 'var(--text-muted)' }}>Manage providers, explore bookings, and monitor mail flows.</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn btn-secondary" onClick={handleTriggerBackgroundJobs}>
            🔄 Run Cron Jobs
          </button>
          <button className="btn btn-primary" onClick={handleOpenDoctorCreate}>
            🩺 Provision Doctor
          </button>
          <button className="btn btn-danger" onClick={() => setIsLeaveModalOpen(true)}>
            🏖️ Record Leave
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '24px', gap: '16px' }}>
        <button 
          className={`btn ${activeTab === 'doctors' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('doctors')}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
        >
          Doctors ({doctors.length})
        </button>
        <button 
          className={`btn ${activeTab === 'appointments' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('appointments')}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
        >
          Appointments ({filteredAppointments.length})
        </button>
        <button 
          className={`btn ${activeTab === 'notifications' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('notifications')}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
        >
          Notifications Logs ({notifications.length})
        </button>
      </div>

      {/* Tab Content: Doctors */}
      {activeTab === 'doctors' && (
        <div className="table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th>Doctor</th>
                <th>Specialisation</th>
                <th>Slot Duration</th>
                <th>Working Hours Summary</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {doctors.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                    No doctors found. Click <strong>Provision Doctor</strong> above to add one.
                  </td>
                </tr>
              ) : (
                doctors.map((doc) => (
                  <tr key={doc.user_id || Math.random()}>
                    <td>
                      <div style={{ fontWeight: '600' }}>{doc.profile?.name || 'Doctor'}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{doc.profile?.email || ''}</div>
                    </td>
                    <td>{doc.specialisation || 'General'}</td>
                    <td>{doc.slot_duration || 30} mins</td>
                    <td>
                      <div style={{ fontSize: '0.85rem' }}>
                        {(() => {
                          let hours = doc.working_hours
                          if (typeof hours === 'string') {
                            try { hours = JSON.parse(hours) } catch (e) { hours = null }
                          }
                          if (hours && typeof hours === 'object' && Object.keys(hours).length > 0) {
                            return Object.keys(hours).map(day => String(day).substring(0, 3)).join(', ').toUpperCase()
                          }
                          return 'Not configured'
                        })()}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${doc.active ? 'badge-completed' : 'badge-cancelled'}`}>
                        {doc.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => handleOpenDoctorEdit(doc)}>
                          ✏️ Edit
                        </button>
                        <button 
                          className={`btn ${doc.active ? 'btn-danger' : 'btn-success'}`}
                          style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                          onClick={() => handleToggleActive(doc.user_id, doc.active)}
                        >
                          {doc.active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab Content: Appointments */}
      {activeTab === 'appointments' && (
        <div>
          {/* Filters */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', padding: '16px', background: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '20px' }}>
            <div>
              <label className="form-label">Doctor Name</label>
              <input type="text" className="form-input" placeholder="Filter by Doctor" value={filterDoc} onChange={e => setFilterDoc(e.target.value)} />
            </div>
            <div>
              <label className="form-label">Patient Name</label>
              <input type="text" className="form-input" placeholder="Filter by Patient" value={filterPatient} onChange={e => setFilterPatient(e.target.value)} />
            </div>
            <div>
              <label className="form-label">Date</label>
              <input type="date" className="form-input" value={filterDate} onChange={e => setFilterDate(e.target.value)} />
            </div>
            <div>
              <label className="form-label">Status</label>
              <select className="form-input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="">All Statuses</option>
                <option value="held">Held</option>
                <option value="confirmed">Confirmed</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          <div className="table-container">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredAppointments.length === 0 ? (
                  <tr>
                    <td colSpan="4" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                      No appointments found.
                    </td>
                  </tr>
                ) : (
                  filteredAppointments.map((app) => (
                    <tr key={app.id || Math.random()}>
                      <td>
                        <div style={{ fontWeight: '600' }}>
                          {app.slot_start ? new Date(app.slot_start).toLocaleDateString() : 'N/A'}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {app.slot_start && app.slot_end 
                            ? `${new Date(app.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(app.slot_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                            : 'N/A'}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: '500' }}>{app.patient?.name || 'Patient'}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{app.patient?.email || ''}</div>
                      </td>
                      <td>Dr. {app.doctor?.name || 'Doctor'}</td>
                      <td>
                        <span className={`badge badge-${app.status || 'confirmed'}`}>
                          {app.status || 'confirmed'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab Content: Notifications Logs */}
      {activeTab === 'notifications' && (
        <div className="table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Type</th>
                <th>Subject</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Retries</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {notifications.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                    No notifications logged yet.
                  </td>
                </tr>
              ) : (
                notifications.map((n) => (
                  <tr key={n.id || Math.random()}>
                    <td>{n.recipient_email || 'N/A'}</td>
                    <td><span className="badge badge-confirmed" style={{ fontSize: '0.65rem' }}>{n.type || 'email'}</span></td>
                    <td>{n.subject || 'No Subject'}</td>
                    <td>{n.channel || 'email'}</td>
                    <td>
                      <span className={`badge ${n.status === 'sent' ? 'badge-completed' : n.status === 'failed' ? 'badge-cancelled' : 'badge-held'}`}>
                        {n.status || 'pending'}
                      </span>
                    </td>
                    <td>{n.retry_count ?? 0} / 5</td>
                    <td>{n.created_at ? new Date(n.created_at).toLocaleString() : 'N/A'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Doctor Modal */}
      <Modal 
        isOpen={isDoctorModalOpen} 
        onClose={() => setIsDoctorModalOpen(false)}
        title={editingDoctor ? 'Edit Doctor Profile' : 'Provision Doctor Profile'}
      >
        <form onSubmit={handleSaveDoctor}>
          <div className="form-group">
            <label className="form-label">Full Name *</label>
            <input type="text" className="form-input" value={docName} onChange={e => setDocName(e.target.value)} required />
          </div>

          {!editingDoctor && (
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Email Address *</label>
                <input type="email" className="form-input" value={docEmail} onChange={e => setDocEmail(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Temporary Password *</label>
                <input type="password" className="form-input" value={docPassword} onChange={e => setDocPassword(e.target.value)} required />
              </div>
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Phone Number</label>
              <input type="tel" className="form-input" value={docPhone} onChange={e => setDocPhone(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Specialisation *</label>
              <input type="text" className="form-input" placeholder="e.g., Cardiology, General Practice" value={docSpec} onChange={e => setDocSpec(e.target.value)} required />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Slot Duration (minutes) *</label>
            <select className="form-input" value={docDuration} onChange={e => setDocDuration(e.target.value)} required>
              <option value="15">15 Minutes</option>
              <option value="30">30 Minutes</option>
              <option value="45">45 Minutes</option>
              <option value="60">60 Minutes</option>
            </select>
          </div>

          <h3 style={{ fontSize: '1rem', marginTop: '20px', marginBottom: '10px' }}>Working Days & Hours</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '250px', overflowY: 'auto', padding: '10px', background: 'var(--bg-input)', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '20px' }}>
            {Object.keys(workingHours).map((day) => (
              <div key={day} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1' }}>
                  <input 
                    type="checkbox" 
                    id={`day-${day}`}
                    checked={workingHours[day].enabled}
                    onChange={(e) => setWorkingHours({
                      ...workingHours,
                      [day]: { ...workingHours[day], enabled: e.target.checked }
                    })}
                  />
                  <label htmlFor={`day-${day}`} style={{ textTransform: 'capitalize', fontWeight: '500' }}>{day}</label>
                </div>
                {workingHours[day].enabled && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input 
                      type="time" 
                      className="form-input" 
                      style={{ padding: '6px', width: '100px', fontSize: '0.85rem' }} 
                      value={workingHours[day].start}
                      onChange={e => setWorkingHours({
                        ...workingHours,
                        [day]: { ...workingHours[day], start: e.target.value }
                      })}
                    />
                    <span style={{ alignSelf: 'center' }}>to</span>
                    <input 
                      type="time" 
                      className="form-input" 
                      style={{ padding: '6px', width: '100px', fontSize: '0.85rem' }} 
                      value={workingHours[day].end}
                      onChange={e => setWorkingHours({
                        ...workingHours,
                        [day]: { ...workingHours[day], end: e.target.value }
                      })}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <button type="submit" className="btn btn-primary btn-full" disabled={loadingAction}>
            {loadingAction ? 'Saving...' : 'Save Profile'}
          </button>
        </form>
      </Modal>

      {/* Leave Modal */}
      <Modal
        isOpen={isLeaveModalOpen}
        onClose={() => setIsLeaveModalOpen(false)}
        title="Mark Doctor On Leave"
      >
        <form onSubmit={handleSaveLeave}>
          <div className="form-group">
            <label className="form-label">Doctor *</label>
            <select className="form-input" value={leaveDoctorId} onChange={e => setLeaveDoctorId(e.target.value)} required>
              <option value="">Select Doctor</option>
              {doctors.filter(d => d.active).map(d => (
                <option key={d.user_id} value={d.user_id}>Dr. {d.profile?.name} ({d.specialisation})</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Date *</label>
            <input type="date" className="form-input" value={leaveDate} onChange={e => setLeaveDate(e.target.value)} required />
          </div>

          <div className="form-group">
            <label className="form-label">Reason</label>
            <input type="text" className="form-input" placeholder="e.g., Annual leave, Medical conference" value={leaveReason} onChange={e => setLeaveReason(e.target.value)} />
          </div>

          <div className="badge badge-high" style={{ width: '100%', display: 'block', textTransform: 'none', padding: '10px', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '20px' }}>
            ⚠️ <strong>Conflicting Bookings Note:</strong> Marking a leave will automatically cancel any confirmed appointments on that date, and trigger emails + in-app warnings prompting patients to reschedule.
          </div>

          <button type="submit" className="btn btn-danger btn-full">
            Confirm & Save Leave
          </button>
        </form>
      </Modal>
    </div>
  )
}

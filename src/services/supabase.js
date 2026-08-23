import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ""
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ""

// We check if variables are missing or placeholders
const isMockMode = !supabaseUrl || !supabaseAnonKey || supabaseUrl.includes("your-project-id")

let supabaseClient = null

if (isMockMode) {
  console.log("ℹ️ MediCare Connect: Supabase credentials not found. Booting in local client-side Mock Mode (persisting to localStorage).")
  supabaseClient = createMockSupabaseClient()
} else {
  supabaseClient = createClient(supabaseUrl, supabaseAnonKey)
}

export const supabase = supabaseClient

// ==========================================
// CLIENT-SIDE MOCK DATABASE IMPLEMENTATION
// ==========================================

function createMockSupabaseClient() {
  // Pre-seed mock data if empty
  initMockStorage()

  // Registered listeners for auth state changes
  const authListeners = new Set()
  let currentUser = getMockUser()

  function getMockUser() {
    const session = localStorage.getItem('mc_session')
    return session ? JSON.parse(session) : null
  }

  function initMockStorage() {
    if (!localStorage.getItem('mc_seeded')) {
      const authUsers = [
        { id: 'admin-id-123', email: 'admin@example.com', name: 'System Admin', role: 'admin' },
        { id: 'doc-id-123', email: 'doctor@example.com', name: 'Dr. Elizabeth Blackwell', role: 'doctor' },
        { id: 'patient-id-123', email: 'patient@example.com', name: 'John Doe', role: 'patient' }
      ]
      
      const profiles = [
        { id: 'admin-id-123', role: 'admin', name: 'System Admin', email: 'admin@example.com', phone: '123456789' },
        { id: 'doc-id-123', role: 'doctor', name: 'Dr. Elizabeth Blackwell', email: 'doctor@example.com', phone: '987654321' },
        { id: 'patient-id-123', role: 'patient', name: 'John Doe', email: 'patient@example.com', phone: '555123456' }
      ]

      const doctors = [
        {
          user_id: 'doc-id-123',
          specialisation: 'General Practice',
          slot_duration: 30,
          active: true,
          working_hours: {
            monday: { start: '09:00', end: '17:00' },
            tuesday: { start: '09:00', end: '17:00' },
            wednesday: { start: '09:00', end: '17:00' },
            thursday: { start: '09:00', end: '17:00' },
            friday: { start: '09:00', end: '17:00' }
          }
        }
      ]

      localStorage.setItem('mc_users', JSON.stringify(authUsers))
      localStorage.setItem('profiles', JSON.stringify(profiles))
      localStorage.setItem('doctor_profiles', JSON.stringify(doctors))
      localStorage.setItem('doctor_leave_days', JSON.stringify([]))
      localStorage.setItem('appointments', JSON.stringify([]))
      localStorage.setItem('symptom_forms', JSON.stringify([]))
      localStorage.setItem('pre_visit_summaries', JSON.stringify([]))
      localStorage.setItem('visit_notes', JSON.stringify([]))
      localStorage.setItem('post_visit_summaries', JSON.stringify([]))
      localStorage.setItem('notifications_log', JSON.stringify([]))
      localStorage.setItem('user_oauth_tokens', JSON.stringify([]))
      localStorage.setItem('calendar_events', JSON.stringify([]))
      
      localStorage.setItem('mc_seeded', 'true')
    }
  }

  function notifyAuthListeners(event, session) {
    authListeners.forEach(cb => cb(event, session))
  }

  // Builder class to simulate supabase-js query syntax
  class MockQueryBuilder {
    constructor(tableName) {
      this.tableName = tableName
      this.filters = []
      this.limitCount = null
      this.orderCol = null
      this.isSingle = false
      this.operation = 'select' // default
      this.opData = null
    }

    // Helper to get raw table list
    getTable() {
      return JSON.parse(localStorage.getItem(this.tableName) || '[]')
    }

    // Helper to save table list
    saveTable(data) {
      localStorage.setItem(this.tableName, JSON.stringify(data))
    }

    eq(field, value) {
      this.filters.push((row) => {
        // Handle nested profile filters
        if (field.includes('!')) return true
        const fields = field.split('.')
        if (fields.length === 2) {
          return row[fields[0]]?.[fields[1]] === value
        }
        return row[field] === value
      })
      return this
    }

    neq(field, value) {
      this.filters.push((row) => row[field] !== value)
      return this
    }

    lt(field, value) {
      this.filters.push((row) => row[field] < value)
      return this
    }

    lte(field, value) {
      this.filters.push((row) => row[field] <= value)
      return this
    }

    gte(field, value) {
      this.filters.push((row) => row[field] >= value)
      return this
    }

    select(fields = '*') {
      // Return this query for chainings
      return this
    }

    order(column, { ascending = true } = {}) {
      this.orderCol = { column, ascending }
      return this
    }

    limit(count) {
      this.limitCount = count
      return this
    }

    single() {
      this.isSingle = true
      return this
    }

    insert(rows) {
      this.operation = 'insert'
      this.opData = rows
      return this
    }

    update(fields) {
      this.operation = 'update'
      this.opData = fields
      return this
    }

    upsert(rows) {
      this.operation = 'upsert'
      this.opData = rows
      return this
    }

    delete() {
      this.operation = 'delete'
      return this
    }

    // Evaluator: executes the reads or database operations
    async then(resolve) {
      try {
        let result = null

        if (this.operation === 'select') {
          let data = this.getTable()

          // Joint tables mock logic
          if (this.tableName === 'doctor_profiles') {
            const profiles = JSON.parse(localStorage.getItem('profiles') || '[]')
            data = data.map(doc => ({
              ...doc,
              profile: profiles.find(p => p.id === doc.user_id)
            }))
          } else if (this.tableName === 'appointments') {
            const profiles = JSON.parse(localStorage.getItem('profiles') || '[]')
            const symptoms = JSON.parse(localStorage.getItem('symptom_forms') || '[]')
            const preVisit = JSON.parse(localStorage.getItem('pre_visit_summaries') || '[]')
            const postVisit = JSON.parse(localStorage.getItem('post_visit_summaries') || '[]')
            const notes = JSON.parse(localStorage.getItem('visit_notes') || '[]')

            data = data.map(app => ({
              ...app,
              patient: profiles.find(p => p.id === app.patient_id),
              doctor: profiles.find(p => p.id === app.doctor_id),
              symptom_forms: symptoms.filter(s => s.appointment_id === app.id),
              pre_visit_summaries: preVisit.filter(s => s.appointment_id === app.id),
              post_visit_summaries: postVisit.filter(s => s.appointment_id === app.id),
              visit_notes: notes.find(n => n.appointment_id === app.id)
            }))
          }

          // Apply filters
          this.filters.forEach(filterFn => {
            data = data.filter(filterFn)
          })

          // Apply ordering
          if (this.orderCol) {
            data.sort((a, b) => {
              const valA = a[this.orderCol.column]
              const valB = b[this.orderCol.column]
              if (valA < valB) return this.orderCol.ascending ? -1 : 1
              if (valA > valB) return this.orderCol.ascending ? 1 : -1
              return 0
            })
          }

          // Apply limits
          if (this.limitCount !== null) {
            data = data.slice(0, this.limitCount)
          }

          if (this.isSingle) {
            result = { data: data[0] || null, error: data[0] ? null : { message: 'Not found' } }
          } else {
            result = { data, error: null }
          }

        } else if (this.operation === 'insert') {
          const tableData = this.getTable()
          const rowsToInsert = Array.isArray(this.opData) ? this.opData : [this.opData]

          const formatted = rowsToInsert.map(row => {
            const id = row.id || row.appointment_id || Math.random().toString(36).substring(2, 15)
            return {
              id,
              created_at: new Date().toISOString(),
              ...row
            }
          })

          // Check Unique constraint on appointments (double-booking check)
          if (this.tableName === 'appointments') {
            const existing = this.getTable()
            for (const newApp of formatted) {
              if (newApp.status !== 'cancelled') {
                const conflict = existing.some(ext => 
                  ext.doctor_id === newApp.doctor_id && 
                  ext.slot_start === newApp.slot_start && 
                  ext.status !== 'cancelled'
                )
                if (conflict) {
                  resolve({ data: null, error: { code: '23505', message: 'Unique key violation (double-booking)' } })
                  return
                }
              }
            }
          }

          tableData.push(...formatted)
          this.saveTable(tableData)

          // Auto triggers simulation
          if (this.tableName === 'doctor_leave_days') {
            // Trigger leave cancellations
            formatted.forEach(leave => simulateLeaveTrigger(leave))
          }

          const returnData = Array.isArray(this.opData) ? formatted : (this.isSingle ? formatted[0] : formatted)
          result = { data: returnData, error: null }

        } else if (this.operation === 'update') {
          const tableData = this.getTable()
          const updated = tableData.map(row => {
            // Apply filters to find which row to update
            let matches = true
            this.filters.forEach(filterFn => {
              if (!filterFn(row)) matches = false
            })

            if (matches) {
              return { ...row, ...this.opData }
            }
            return row
          })

          this.saveTable(updated)
          const affected = updated.filter(row => {
            let matches = true
            this.filters.forEach(filterFn => {
              if (!filterFn(row)) matches = false
            })
            return matches
          })

          result = { data: this.isSingle ? affected[0] : affected, error: null }

        } else if (this.operation === 'upsert') {
          const tableData = this.getTable()
          const rowsToUpsert = Array.isArray(this.opData) ? this.opData : [this.opData]

          rowsToUpsert.forEach(newRow => {
            const matchKey = newRow.id ? 'id' : newRow.user_id ? 'user_id' : newRow.appointment_id ? 'appointment_id' : null
            const existingIdx = tableData.findIndex(r => r[matchKey] === newRow[matchKey])

            if (existingIdx > -1) {
              tableData[existingIdx] = { ...tableData[existingIdx], ...newRow }
            } else {
              tableData.push({
                created_at: new Date().toISOString(),
                ...newRow
              })
            }
          })

          this.saveTable(tableData)
          result = { data: rowsToUpsert, error: null }

        } else if (this.operation === 'delete') {
          const tableData = this.getTable()
          const kept = tableData.filter(row => {
            let matches = true
            this.filters.forEach(filterFn => {
              if (!filterFn(row)) matches = false
            })
            return !matches
          })

          this.saveTable(kept)
          result = { data: null, error: null }
        }

        resolve(result)
      } catch (err) {
        resolve({ data: null, error: { message: err.message } })
      }
    }
  }

  // Database Leave conflict simulator
  function simulateLeaveTrigger(leave) {
    const appointments = JSON.parse(localStorage.getItem('appointments') || '[]')
    const profiles = JSON.parse(localStorage.getItem('profiles') || '[]')
    const notifs = JSON.parse(localStorage.getItem('notifications_log') || '[]')

    const affected = appointments.filter(a => 
      a.doctor_id === leave.doctor_id && 
      a.slot_start.startsWith(leave.date) && 
      (a.status === 'confirmed' || a.status === 'held')
    )

    if (affected.length > 0) {
      const doctor = profiles.find(p => p.id === leave.doctor_id)
      
      affected.forEach(app => {
        const patient = profiles.find(p => p.id === app.patient_id)
        
        // Cancel appointment
        app.status = 'cancelled'
        
        // Add log
        notifs.push({
          id: Math.random().toString(36).substring(2, 12),
          appointment_id: app.id,
          type: 'leave_cancellation',
          channel: 'email',
          status: 'sent',
          recipient_email: patient?.email || 'patient@example.com',
          subject: `Appointment Cancelled: Dr. ${doctor?.name || 'Doctor'} is on leave`,
          body: `Dear ${patient?.name || 'Patient'}, your appointment on ${leave.date} has been cancelled because the doctor is on leave. Reason: ${leave.reason || 'Doctor on leave'}.`,
          sent_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        })
      })

      localStorage.setItem('appointments', JSON.stringify(appointments))
      localStorage.setItem('notifications_log', JSON.stringify(notifs))
    }
  }

  // Returns mocked client
  return {
    auth: {
      async getSession() {
        const user = getMockUser()
        return { data: { session: user ? { user } : null }, error: null }
      },
      onAuthStateChange(callback) {
        authListeners.add(callback)
        const user = getMockUser()
        // Fire initial event
        setTimeout(() => callback('SIGNED_IN', user ? { user } : null), 0)
        return {
          data: {
            subscription: {
              unsubscribe() {
                authListeners.delete(callback)
              }
            }
          }
        }
      },
      async signInWithPassword({ email, password }) {
        const users = JSON.parse(localStorage.getItem('mc_users') || '[]')
        const matched = users.find(u => u.email === email)

        if (!matched) {
          return { data: null, error: { message: 'Invalid login credentials' } }
        }

        localStorage.setItem('mc_session', JSON.stringify(matched))
        currentUser = matched
        notifyAuthListeners('SIGNED_IN', { user: matched })
        return { data: { user: matched }, error: null }
      },
      async signUp({ email, password, options }) {
        const users = JSON.parse(localStorage.getItem('mc_users') || '[]')
        const emailExists = users.some(u => u.email === email)

        if (emailExists) {
          return { data: null, error: { message: 'Email already registered' } }
        }

        const name = options?.data?.name || 'New Patient'
        const role = options?.data?.role || 'patient'
        const newUser = {
          id: Math.random().toString(36).substring(2, 15),
          email,
          name,
          role
        }

        // Add auth user
        users.push(newUser)
        localStorage.setItem('mc_users', JSON.stringify(users))

        // Create profile trigger
        const profiles = JSON.parse(localStorage.getItem('profiles') || '[]')
        profiles.push({
          id: newUser.id,
          role,
          name,
          email,
          phone: null
        })
        localStorage.setItem('profiles', JSON.stringify(profiles))

        return { data: { user: newUser }, error: null }
      },
      async signOut() {
        localStorage.removeItem('mc_session')
        currentUser = null
        notifyAuthListeners('SIGNED_OUT', null)
        return { error: null }
      }
    },

    from(tableName) {
      return new MockQueryBuilder(tableName)
    },

    functions: {
      async invoke(name, { body } = {}) {
        console.log(`[MOCK EDGE FUNCTION CALL] Invoking function: ${name}`, body)
        
        // Simulate Edge Function responses locally
        if (name === 'google-calendar-oauth') {
          const tokens = JSON.parse(localStorage.getItem('user_oauth_tokens') || '[]')
          const mockToken = {
            user_id: currentUser?.id || 'doc-id-123',
            access_token: 'mock-access-token',
            refresh_token: 'mock-refresh-token',
            expiry_time: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
            updated_at: new Date().toISOString()
          }
          const existingIdx = tokens.findIndex(t => t.user_id === mockToken.user_id)
          if (existingIdx > -1) {
            tokens[existingIdx] = mockToken
          } else {
            tokens.push(mockToken)
          }
          localStorage.setItem('user_oauth_tokens', JSON.stringify(tokens))
          return { data: { success: true }, error: null }
        }

        if (name === 'manage-doctors') {
          const { action, email, password, name: docName, phone, specialisation, workingHours, slotDuration, doctorId } = body
          
          const users = JSON.parse(localStorage.getItem('mc_users') || '[]')
          const profiles = JSON.parse(localStorage.getItem('profiles') || '[]')
          const doctors = JSON.parse(localStorage.getItem('doctor_profiles') || '[]')

          if (action === 'create') {
            const newDocId = 'doc-' + Math.random().toString(36).substring(2, 9)
            
            users.push({ id: newDocId, email, name: docName, role: 'doctor' })
            profiles.push({ id: newDocId, role: 'doctor', name: docName, email, phone })
            doctors.push({
              user_id: newDocId,
              specialisation,
              working_hours: workingHours,
              slot_duration: slotDuration,
              active: true
            })

            localStorage.setItem('mc_users', JSON.stringify(users))
            localStorage.setItem('profiles', JSON.stringify(profiles))
            localStorage.setItem('doctor_profiles', JSON.stringify(doctors))
            return { data: { success: true, doctorId: newDocId }, error: null }

          } else if (action === 'update') {
            const idx = doctors.findIndex(d => d.user_id === doctorId)
            const pIdx = profiles.findIndex(p => p.id === doctorId)

            if (idx > -1) {
              doctors[idx] = { ...doctors[idx], specialisation, working_hours: workingHours, slot_duration: slotDuration }
            }
            if (pIdx > -1) {
              profiles[pIdx] = { ...profiles[pIdx], name: docName, phone }
            }

            localStorage.setItem('doctor_profiles', JSON.stringify(doctors))
            localStorage.setItem('profiles', JSON.stringify(profiles))
            return { data: { success: true }, error: null }

          } else if (action === 'toggle_active') {
            const idx = doctors.findIndex(d => d.user_id === doctorId)
            if (idx > -1) {
              doctors[idx].active = body.active
            }
            localStorage.setItem('doctor_profiles', JSON.stringify(doctors))
            return { data: { success: true }, error: null }
          }
        }

        if (name === 'llm-summaries') {
          const { type, appointmentId } = body
          
          if (type === 'pre_visit') {
            const preVisit = JSON.parse(localStorage.getItem('pre_visit_summaries') || '[]')
            const symptoms = JSON.parse(localStorage.getItem('symptom_forms') || '[]')
            const sym = symptoms.find(s => s.appointment_id === appointmentId)

            const mockPre = {
              appointment_id: appointmentId,
              urgency_level: sym?.severity === 'high' ? 'High' : sym?.severity === 'low' ? 'Low' : 'Medium',
              chief_complaint: `Patient complaints of ${sym?.symptoms_text || 'symptoms'}.`,
              suggested_questions: [
                "When exactly did the symptoms start?",
                "Are there any relieving or aggravating factors?",
                "Have you taken any medications for this?"
              ],
              raw_llm_response: "Mocked Gemini Response",
              status: 'completed'
            }

            // Upsert
            const pIdx = preVisit.findIndex(p => p.appointment_id === appointmentId)
            if (pIdx > -1) preVisit[pIdx] = mockPre
            else preVisit.push(mockPre)

            localStorage.setItem('pre_visit_summaries', JSON.stringify(preVisit))
            return { data: { success: true }, error: null }

          } else if (type === 'post_visit') {
            const postVisit = JSON.parse(localStorage.getItem('post_visit_summaries') || '[]')
            const notes = JSON.parse(localStorage.getItem('visit_notes') || '[]')
            const note = notes.find(n => n.appointment_id === appointmentId)

            const mockPost = {
              appointment_id: appointmentId,
              summary_text: `Doctor completed your consultation. Diagnosed symptoms and advised: ${note?.clinical_notes || 'rest'}.`,
              medication_schedule: note?.prescription?.map(rx => `${rx.name} ${rx.dosage}: Take ${rx.frequency} for ${rx.duration}.`).join('\n') || 'No medications.',
              follow_up_steps: "Drink water, get plenty of rest, and follow up in one week if symptoms do not improve.",
              raw_llm_response: "Mocked Gemini Post Response",
              status: 'completed'
            }

            const pIdx = postVisit.findIndex(p => p.appointment_id === appointmentId)
            if (pIdx > -1) postVisit[pIdx] = mockPost
            else postVisit.push(mockPost)

            localStorage.setItem('post_visit_summaries', JSON.stringify(postVisit))
            return { data: { success: true }, error: null }
          }
        }

        if (name === 'background-jobs') {
          // Release expired held appointments
          const appointments = JSON.parse(localStorage.getItem('appointments') || '[]')
          let expiredCount = 0
          
          const updated = appointments.map(app => {
            if (app.status === 'held' && new Date(app.held_until) < new Date()) {
              expiredCount++
              return { ...app, status: 'cancelled' }
            }
            return app
          })

          localStorage.setItem('appointments', JSON.stringify(updated))
          return { data: { success: true, results: { expiredHolds: { count: expiredCount }, notificationRetries: { retried: 0 } } }, error: null }
        }

        // Default response
        return { data: { success: true }, error: null }
      }
    }
  }
}

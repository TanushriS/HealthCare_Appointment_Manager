import { supabase } from './supabase'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ""

/**
 * Checks if the application is running in local client-side Mock Mode
 * @returns {boolean}
 */
function isLocalMockMode() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ""
  return !supabaseUrl || supabaseUrl.includes("your-project-id")
}

/**
 * Generates Google Calendar OAuth URL and redirects the user to link their account
 * @param {string} userId - The active user's UUID to pass as state parameter
 */
export function connectGoogleCalendar(userId) {
  if (!GOOGLE_CLIENT_ID) {
    alert("VITE_GOOGLE_CLIENT_ID is not configured in environment variables.")
    return
  }

  const redirectUri = `${window.location.origin}/oauth/callback`
  const scope = "https://www.googleapis.com/auth/calendar.events"
  
  // Use Implicit Flow (response_type=token) in mock mode to retrieve a real token directly on client-side.
  // Use Authorization Code Flow (response_type=code) in live mode for secure server-side exchanges.
  const responseType = isLocalMockMode() ? "token" : "code"
  
  let oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + 
    `client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=${responseType}&` +
    `scope=${encodeURIComponent(scope)}&` +
    `state=${encodeURIComponent(userId)}`

  if (!isLocalMockMode()) {
    oauthUrl += `&access_type=offline&prompt=consent`
  }

  window.location.href = oauthUrl
}

/**
 * Sends authorization code to the edge function to exchange for access/refresh tokens
 * @param {string} code - Authorization code from Google redirect
 * @returns {Promise<boolean>}
 */
export async function exchangeOAuthCode(code) {
  const redirectUri = `${window.location.origin}/oauth/callback`
  
  try {
    const { data, error } = await supabase.functions.invoke('google-calendar-oauth', {
      body: { code, redirectUri }
    })

    if (error) {
      throw error
    }

    return data?.success || false
  } catch (err) {
    console.error("OAuth code exchange failed:", err)
    return false
  }
}

/**
 * Syncs an appointment to Google Calendar
 * @param {string} action - 'create', 'sync', or 'delete'
 * @param {string} appointmentId - The appointment UUID
 */
export async function syncAppointmentToCalendar(action, appointmentId) {
  if (isLocalMockMode()) {
    return await syncMockCalendarEvent(action, appointmentId)
  }

  try {
    const { data, error } = await supabase.functions.invoke('google-calendar-sync', {
      body: { action, appointmentId }
    })

    if (error) {
      throw error
    }

    return data
  } catch (err) {
    console.error("Google Calendar sync failed:", err)
    return { error: err.message }
  }
}

/**
 * Directly calls Google Calendar API from the browser using client-side access token
 */
async function syncMockCalendarEvent(action, appointmentId) {
  try {
    const appointments = JSON.parse(localStorage.getItem('appointments') || '[]')
    const profiles = JSON.parse(localStorage.getItem('profiles') || '[]')
    const app = appointments.find(a => a.id === appointmentId)

    if (!app) throw new Error("Appointment not found")

    const patient = profiles.find(p => p.id === app.patient_id)
    const doctor = profiles.find(p => p.id === app.doctor_id)

    // Fetch token for the logged-in user
    const userSession = JSON.parse(localStorage.getItem('mc_session'))
    if (!userSession) throw new Error("User session not found")

    const tokens = JSON.parse(localStorage.getItem('user_oauth_tokens') || '[]')
    const tokenData = tokens.find(t => t.user_id === userSession.id)

    if (!tokenData) {
      throw new Error("Google Calendar account is not linked")
    }

    const accessToken = tokenData.access_token
    const calendarEvents = JSON.parse(localStorage.getItem('calendar_events') || '[]')
    const calEvent = calendarEvents.find(c => c.appointment_id === appointmentId) || {
      appointment_id: appointmentId,
      patient_event_id: null,
      doctor_event_id: null,
      sync_status: 'pending'
    }

    // Since in mock mode we sync to the logged-in user's calendar, we store the created event ID
    let eventId = calEvent.patient_event_id || calEvent.doctor_event_id

    const eventDetails = {
      summary: `MediCare Connect Appointment: Dr. ${doctor?.name || 'Doctor'} & ${patient?.name || 'Patient'}`,
      description: `Consultation booked on MediCare Connect.\nPatient: ${patient?.name}\nDoctor: Dr. ${doctor?.name}\nStatus: ${app.status}`,
      start: { dateTime: new Date(app.slot_start).toISOString() },
      end: { dateTime: new Date(app.slot_end).toISOString() }
    }

    if (action === 'create' || action === 'sync') {
      if (eventId) {
        // Update Event
        const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(eventDetails)
        })
        if (!res.ok) throw new Error(`Google Calendar API Update failed: ${await res.text()}`)
      } else {
        // Create Event
        const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(eventDetails)
        })
        if (!res.ok) throw new Error(`Google Calendar API Insert failed: ${await res.text()}`)
        const data = await res.json()
        eventId = data.id
      }
      calEvent.patient_event_id = eventId
      calEvent.sync_status = 'synced'
      calEvent.error_message = null
    } else if (action === 'delete' || app.status === 'cancelled') {
      if (eventId) {
        const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        })
        if (!res.ok && res.status !== 410) throw new Error(`Google Calendar API Delete failed: ${await res.text()}`)
      }
      calEvent.patient_event_id = null
      calEvent.doctor_event_id = null
      calEvent.sync_status = 'pending'
      calEvent.error_message = null
    }

    // Save back to mock DB
    const idx = calendarEvents.findIndex(c => c.appointment_id === appointmentId)
    if (idx > -1) calendarEvents[idx] = calEvent
    else calendarEvents.push(calEvent)
    localStorage.setItem('calendar_events', JSON.stringify(calendarEvents))

    return { success: true }
  } catch (err) {
    console.error("Local mock calendar sync failed:", err)
    return { error: err.message }
  }
}


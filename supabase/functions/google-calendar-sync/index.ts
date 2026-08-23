import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ""
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ""
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { action, appointmentId } = await req.json()

    if (!appointmentId || !action) {
      return new Response(JSON.stringify({ error: "Missing action or appointmentId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    // Initialize calendar_events row if it doesn't exist
    await supabase.from('calendar_events').upsert({
      appointment_id: appointmentId,
      sync_status: 'pending'
    })

    // Fetch appointment detail
    const { data: appointment, error: appErr } = await supabase
      .from('appointments')
      .select(`
        id, slot_start, slot_end, status,
        patient_id, doctor_id,
        patient:profiles!appointments_patient_id_fkey(name),
        doctor:profiles!appointments_doctor_id_fkey(name)
      `)
      .eq('id', appointmentId)
      .single()

    if (appErr || !appointment) {
      throw new Error(`Appointment not found: ${appErr?.message ?? ""}`)
    }

    // Fetch calendar event reference
    const { data: calEvent } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('appointment_id', appointmentId)
      .single()

    const patientToken = await getValidAccessToken(supabase, appointment.patient_id)
    const doctorToken = await getValidAccessToken(supabase, appointment.doctor_id)

    let patientEventId = calEvent?.patient_event_id || null
    let doctorEventId = calEvent?.doctor_event_id || null
    let syncStatus = 'synced'
    let errorMessage = null

    const eventDetails = {
      summary: `MediCare Connect Appointment: Dr. ${appointment.doctor?.name} & ${appointment.patient?.name}`,
      description: `Healthcare consultation on MediCare Connect platform.\nPatient: ${appointment.patient?.name}\nDoctor: Dr. ${appointment.doctor?.name}\nStatus: ${appointment.status}`,
      start: { dateTime: new Date(appointment.slot_start).toISOString() },
      end: { dateTime: new Date(appointment.slot_end).toISOString() }
    }

    try {
      if (action === 'create' || action === 'sync') {
        // Create or update in Patient's calendar
        if (patientToken) {
          if (patientEventId) {
            await updateGoogleEvent(patientToken, 'primary', patientEventId, eventDetails)
          } else {
            patientEventId = await createGoogleEvent(patientToken, 'primary', eventDetails)
          }
        }

        // Create or update in Doctor's calendar
        if (doctorToken) {
          if (doctorEventId) {
            await updateGoogleEvent(doctorToken, 'primary', doctorEventId, eventDetails)
          } else {
            doctorEventId = await createGoogleEvent(doctorToken, 'primary', eventDetails)
          }
        }
      } else if (action === 'delete' || appointment.status === 'cancelled') {
        // Delete from Patient's calendar
        if (patientToken && patientEventId) {
          await deleteGoogleEvent(patientToken, 'primary', patientEventId)
          patientEventId = null
        }
        // Delete from Doctor's calendar
        if (doctorToken && doctorEventId) {
          await deleteGoogleEvent(doctorToken, 'primary', doctorEventId)
          doctorEventId = null
        }
      }
    } catch (apiErr) {
      console.error("Google Calendar API call failed:", apiErr)
      syncStatus = 'failed'
      errorMessage = apiErr.message
    }

    // Update database
    await supabase.from('calendar_events').upsert({
      appointment_id: appointmentId,
      patient_event_id: patientEventId,
      doctor_event_id: doctorEventId,
      sync_status: syncStatus,
      error_message: errorMessage
    })

    return new Response(JSON.stringify({ success: true, syncStatus, errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    })
  }
})

// Helper to check and refresh tokens
async function getValidAccessToken(supabase: any, userId: string): Promise<string | null> {
  const { data, error } = await supabase.from('user_oauth_tokens').select('*').eq('user_id', userId).single()
  if (error || !data) return null

  const now = new Date()
  const buffer = 5 * 60 * 1000 // 5-minute buffer
  if (new Date(data.expiry_time).getTime() - buffer > now.getTime()) {
    return data.access_token
  }

  // Token is expired or expiring soon, refresh it
  if (!data.refresh_token) return null

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID") || ""
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") || ""

  if (!clientId || !clientSecret) {
    console.warn("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not configured. Cannot refresh Google Calendar OAuth token.")
    return null
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: data.refresh_token,
        grant_type: "refresh_token"
      })
    })

    if (!res.ok) {
      console.error(`Failed to refresh Google OAuth token for user ${userId}. Status: ${res.status}`)
      return null
    }

    const tokens = await res.json()
    const expiryTime = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    await supabase.from('user_oauth_tokens').update({
      access_token: tokens.access_token,
      expiry_time: expiryTime,
      updated_at: new Date().toISOString()
    }).eq('user_id', userId)

    return tokens.access_token
  } catch (err) {
    console.error(`Error refreshing OAuth token for user ${userId}:`, err)
    return null
  }
}

// Google Calendar REST API helpers
async function createGoogleEvent(accessToken: string, calendarId: string, event: any): Promise<string> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(event)
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Google Calendar create event failed: ${errText}`)
  }
  const data = await res.json()
  return data.id
}

async function updateGoogleEvent(accessToken: string, calendarId: string, eventId: string, event: any): Promise<void> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(event)
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Google Calendar update event failed: ${errText}`)
  }
}

async function deleteGoogleEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${accessToken}`
    }
  })
  // 410 Gone means the event was already deleted
  if (!res.ok && res.status !== 410) {
    const errText = await res.text()
    throw new Error(`Google Calendar delete event failed: ${errText}`)
  }
}

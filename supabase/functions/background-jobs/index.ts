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

  const results: Record<string, any> = {}

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ""
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ""
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Release Expired Holds
    // Update appointments to 'cancelled' if they have been held past their expiry time
    const { data: releasedHolds, error: holdErr } = await supabase
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('status', 'held')
      .lt('held_until', new Date().toISOString())
      .select('id')

    if (holdErr) {
      results.expiredHolds = { error: holdErr.message }
    } else {
      results.expiredHolds = { count: releasedHolds?.length || 0, ids: releasedHolds?.map(r => r.id) || [] }
    }

    // 2. Queue Appointment Reminders (e.g., appointments starting in 24 hours)
    // Find confirmed appointments starting in 23-25 hours that don't have a reminder logged yet
    const oneDayFromNowMin = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString()
    const oneDayFromNowMax = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString()

    const { data: upcomingApps, error: appErr } = await supabase
      .from('appointments')
      .select(`
        id, 
        slot_start, 
        patient:profiles!appointments_patient_id_fkey(email, name),
        doctor:profiles!appointments_doctor_id_fkey(name)
      `)
      .eq('status', 'confirmed')
      .gte('slot_start', oneDayFromNowMin)
      .lte('slot_start', oneDayFromNowMax)

    if (appErr) {
      results.appointmentReminders = { error: appErr.message }
    } else {
      let reminderCount = 0
      if (upcomingApps && upcomingApps.length > 0) {
        for (const app of upcomingApps) {
          // Check if reminder notification already exists
          const { count, error: countErr } = await supabase
            .from('notifications_log')
            .select('*', { count: 'exact', head: true })
            .eq('appointment_id', app.id)
            .eq('type', 'reminder')

          if (!countErr && count === 0) {
            // Queue notification
            const slotTimeStr = new Date(app.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            const slotDateStr = new Date(app.slot_start).toLocaleDateString()
            
            const { data: newNotif, error: insErr } = await supabase
              .from('notifications_log')
              .insert({
                appointment_id: app.id,
                type: 'reminder',
                channel: 'email',
                status: 'pending',
                recipient_email: app.patient?.email,
                subject: `Appointment Reminder: Dr. ${app.doctor?.name}`,
                body: `Hello ${app.patient?.name},\n\nThis is a reminder that you have an upcoming appointment with Dr. ${app.doctor?.name} tomorrow, ${slotDateStr} at ${slotTimeStr}. Please log in to complete your symptom form if you have not done so already.\n\nBest regards,\nMediCare Connect Team`
              })
              .select('id')
              .single()

            if (!insErr && newNotif) {
              reminderCount++
              // Fire off notification trigger
              triggerNotification(supabaseUrl, supabaseServiceKey, newNotif.id)
            }
          }
        }
      }
      results.appointmentReminders = { processed: upcomingApps?.length || 0, queued: reminderCount }
    }

    // 3. Retry Failed Notifications
    // Find failed notifications with less than 5 retries
    const { data: failedNotifs, error: fErr } = await supabase
      .from('notifications_log')
      .select('id')
      .eq('status', 'failed')
      .lt('retry_count', 5)

    if (fErr) {
      results.notificationRetries = { error: fErr.message }
    } else {
      if (failedNotifs && failedNotifs.length > 0) {
        for (const notif of failedNotifs) {
          triggerNotification(supabaseUrl, supabaseServiceKey, notif.id)
        }
      }
      results.notificationRetries = { retried: failedNotifs?.length || 0 }
    }

    // 4. Retry Failed LLM Summaries (pre-visit and post-visit summaries)
    // Find pre-visit summaries with status 'failed'
    const { data: failedPreVisit, error: fpErr } = await supabase
      .from('pre_visit_summaries')
      .select('appointment_id')
      .eq('status', 'failed')

    if (fpErr) {
      results.preVisitLLMRetries = { error: fpErr.message }
    } else {
      if (failedPreVisit && failedPreVisit.length > 0) {
        for (const summary of failedPreVisit) {
          triggerLLM(supabaseUrl, supabaseServiceKey, 'pre_visit', summary.appointment_id)
        }
      }
      results.preVisitLLMRetries = { retried: failedPreVisit?.length || 0 }
    }

    // Find post-visit summaries with status 'failed'
    const { data: failedPostVisit, error: fpostErr } = await supabase
      .from('post_visit_summaries')
      .select('appointment_id')
      .eq('status', 'failed')

    if (fpostErr) {
      results.postVisitLLMRetries = { error: fpostErr.message }
    } else {
      if (failedPostVisit && failedPostVisit.length > 0) {
        for (const summary of failedPostVisit) {
          triggerLLM(supabaseUrl, supabaseServiceKey, 'post_visit', summary.appointment_id)
        }
      }
      results.postVisitLLMRetries = { retried: failedPostVisit?.length || 0 }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    })
  }
})

// Helper to fire notification asynchronously
function triggerNotification(supabaseUrl: string, serviceKey: string, notificationId: string) {
  fetch(`${supabaseUrl}/functions/v1/notifications`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`
    },
    body: JSON.stringify({ notificationId })
  }).catch(err => console.error("Async triggerNotification failed", err))
}

// Helper to fire LLM summary asynchronously
function triggerLLM(supabaseUrl: string, serviceKey: string, type: 'pre_visit' | 'post_visit', appointmentId: string) {
  fetch(`${supabaseUrl}/functions/v1/llm-summaries`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`
    },
    body: JSON.stringify({ type, appointmentId })
  }).catch(err => console.error(`Async triggerLLM ${type} failed`, err))
}

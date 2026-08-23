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

    const { notificationId } = await req.json()

    if (!notificationId) {
      return new Response(JSON.stringify({ error: "Missing notificationId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    // 1. Fetch notification from database
    const { data: notif, error: nErr } = await supabase
      .from('notifications_log')
      .select('*')
      .eq('id', notificationId)
      .single()

    if (nErr || !notif) {
      throw new Error("Could not find notification record: " + (nErr?.message ?? "Not found"))
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY") || ""

    try {
      if (resendApiKey) {
        // Send email via Resend API
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${resendApiKey}`
          },
          body: JSON.stringify({
            from: "MediCare Connect <onboarding@resend.dev>", // Resend sandbox default from address
            to: notif.recipient_email,
            subject: notif.subject,
            html: `<div style="font-family: sans-serif; padding: 20px; color: #333;">
              <h2 style="color: #2563eb;">MediCare Connect</h2>
              <p>${notif.body.replace(/\n/g, '<br>')}</p>
              <br>
              <hr style="border: 0; border-top: 1px solid #eee;">
              <p style="font-size: 12px; color: #666;">This is an automated message from MediCare Connect. Please do not reply directly.</p>
            </div>`
          })
        })

        if (!response.ok) {
          const errText = await response.text()
          throw new Error(`Resend API returned status ${response.status}: ${errText}`)
        }

        await supabase.from('notifications_log').update({
          status: 'sent',
          sent_at: new Date().toISOString()
        }).eq('id', notificationId)

      } else {
        // Fallback dummy mode if RESEND_API_KEY is not set (convenient for local dev/testing)
        console.log(`[EMAIL SEND SIMULATION] To: ${notif.recipient_email} | Subject: ${notif.subject}`)
        console.log(`[EMAIL BODY] ${notif.body}`)

        await supabase.from('notifications_log').update({
          status: 'sent',
          sent_at: new Date().toISOString()
        }).eq('id', notificationId)
      }

    } catch (sendErr) {
      console.error(`Email send failed for notification ID ${notificationId}:`, sendErr)
      await supabase.from('notifications_log').update({
        status: 'failed',
        retry_count: (notif.retry_count || 0) + 1
      }).eq('id', notificationId)
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    })
  }
})

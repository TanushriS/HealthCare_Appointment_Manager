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

    // Verify caller JWT and check if they are an admin
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)

    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized caller JWT" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    const { data: callerProfile, error: profileErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profileErr || callerProfile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: "Forbidden: Caller is not an admin" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    const body = await req.json()
    const { action, email, password, name, phone, specialisation, workingHours, slotDuration, doctorId } = body

    if (action === 'create') {
      if (!email || !password || !name || !specialisation || !workingHours) {
        return new Response(JSON.stringify({ error: "Missing required fields for creation" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        })
      }

      // 1. Create auth user in Supabase
      const { data: authData, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, role: 'doctor' }
      })

      if (createErr || !authData.user) {
        throw new Error("Auth user creation failed: " + (createErr?.message ?? ""))
      }

      const newDoctorId = authData.user.id

      // 2. Wait or update the profile (trigger might have created it as patient by default, so we update it to doctor)
      const { error: profErr } = await supabase
        .from('profiles')
        .update({
          name,
          phone: phone || null,
          role: 'doctor'
        })
        .eq('id', newDoctorId)

      if (profErr) {
        throw new Error("Updating profile role failed: " + profErr.message)
      }

      // 3. Create doctor details
      const { error: docErr } = await supabase
        .from('doctor_profiles')
        .insert({
          user_id: newDoctorId,
          specialisation,
          working_hours: workingHours,
          slot_duration: slotDuration || 30,
          active: true
        })

      if (docErr) {
        throw new Error("Creating doctor profile failed: " + docErr.message)
      }

      return new Response(JSON.stringify({ success: true, doctorId: newDoctorId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })

    } else if (action === 'update') {
      if (!doctorId || !name || !specialisation || !workingHours) {
        return new Response(JSON.stringify({ error: "Missing doctorId or fields to update" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        })
      }

      // Update profile name
      const { error: profErr } = await supabase
        .from('profiles')
        .update({ name, phone: phone || null })
        .eq('id', doctorId)

      if (profErr) {
        throw new Error("Updating profile name failed: " + profErr.message)
      }

      // Update doctor details
      const { error: docErr } = await supabase
        .from('doctor_profiles')
        .update({
          specialisation,
          working_hours: workingHours,
          slot_duration: slotDuration || 30
        })
        .eq('user_id', doctorId)

      if (docErr) {
        throw new Error("Updating doctor profile failed: " + docErr.message)
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })

    } else if (action === 'toggle_active') {
      if (!doctorId || body.active === undefined) {
        return new Response(JSON.stringify({ error: "Missing doctorId or active status" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        })
      }

      const { error: docErr } = await supabase
        .from('doctor_profiles')
        .update({ active: body.active })
        .eq('user_id', doctorId)

      if (docErr) {
        throw new Error("Toggling doctor active status failed: " + docErr.message)
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })

    } else if (action === 'delete') {
      if (!doctorId) {
        return new Response(JSON.stringify({ error: "Missing doctorId" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        })
      }

      // Delete from doctor_profiles table
      const { error: dpErr } = await supabase
        .from('doctor_profiles')
        .delete()
        .eq('user_id', doctorId)

      if (dpErr) {
        throw new Error("Deleting doctor profile failed: " + dpErr.message)
      }

      // Delete from profiles table
      const { error: pErr } = await supabase
        .from('profiles')
        .delete()
        .eq('id', doctorId)

      if (pErr) {
        throw new Error("Deleting profiles record failed: " + pErr.message)
      }

      // Delete user account from Supabase Auth permanently
      const { error: authErr } = await supabase.auth.admin.deleteUser(doctorId)

      if (authErr) {
        throw new Error("Deleting auth user failed: " + authErr.message)
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })

    } else {
      return new Response(JSON.stringify({ error: "Invalid action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    })
  }
})

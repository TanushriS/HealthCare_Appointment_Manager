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
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ""
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ""

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { type, appointmentId } = await req.json()

    if (!appointmentId || !type) {
      return new Response(JSON.stringify({ error: "Missing type or appointmentId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    if (type === 'pre_visit') {
      // 1. Fetch symptoms data
      const { data: symptomData, error: sErr } = await supabase
        .from('symptom_forms')
        .select('*')
        .eq('appointment_id', appointmentId)
        .single()

      if (sErr || !symptomData) {
        throw new Error("Could not find symptom details: " + (sErr?.message ?? "Not found"))
      }

      const symptoms = `Symptoms: ${symptomData.symptoms_text}, Severity: ${symptomData.severity}, Duration: ${symptomData.duration}`

      // Create pre_visit entry if not exists
      await supabase.from('pre_visit_summaries').upsert({
        appointment_id: appointmentId,
        status: 'pending'
      })

      try {
        const result = await callLLM(
          `Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor. Symptoms: ${symptoms}`,
          `You are an expert medical assistant. You MUST return a JSON object with EXACTLY the following keys: "urgency_level" (must be "Low", "Medium", or "High"), "chief_complaint" (string), and "suggested_questions" (an array of exactly 3 strings). Example structure: {"urgency_level": "Medium", "chief_complaint": "Persistent headache for 3 days", "suggested_questions": ["Is this stress-related?", "Should I take painkillers?", "Are there other symptoms?"]}`
        )

        const parsed = JSON.parse(result.text)
        const urgency = parsed.urgency_level || 'Medium'
        const chiefComplaint = parsed.chief_complaint || 'Symptom analysis'
        const suggestedQuestions = parsed.suggested_questions || []

        await supabase.from('pre_visit_summaries').update({
          urgency_level: ['Low', 'Medium', 'High'].includes(urgency) ? urgency : 'Medium',
          chief_complaint: chiefComplaint,
          suggested_questions: suggestedQuestions,
          raw_llm_response: result.raw,
          status: 'completed'
        }).eq('appointment_id', appointmentId)

      } catch (llmErr) {
        console.error("LLM Pre-visit summary generation failed:", llmErr)
        await supabase.from('pre_visit_summaries').update({
          status: 'failed',
          raw_llm_response: String(llmErr)
        }).eq('appointment_id', appointmentId)
      }

    } else if (type === 'post_visit') {
      // 1. Fetch clinical notes
      const { data: notesData, error: nErr } = await supabase
        .from('visit_notes')
        .select('*')
        .eq('appointment_id', appointmentId)
        .single()

      if (nErr || !notesData) {
        throw new Error("Could not find visit notes: " + (nErr?.message ?? "Not found"))
      }

      const notes = `Clinical Notes: ${notesData.clinical_notes}. Prescriptions: ${JSON.stringify(notesData.prescription)}`

      // Create post_visit entry if not exists
      await supabase.from('post_visit_summaries').upsert({
        appointment_id: appointmentId,
        status: 'pending'
      })

      try {
        const result = await callLLM(
          `Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps: ${notes}`,
          `You are a compassionate doctor translating notes for patients. You MUST return a JSON object with EXACTLY the following keys: "summary_text" (patient-friendly wording of clinical notes), "medication_schedule" (schedule derived from the prescription), and "follow_up_steps" (what the patient should do next). Example structure: {"summary_text": "We discussed your throat infection. It is a mild infection.", "medication_schedule": "Amoxicillin 500mg: Take 1 capsule 3 times daily for 7 days.", "follow_up_steps": "Drink plenty of water and rest. Return if fever persists beyond 3 days."}`
        )

        const parsed = JSON.parse(result.text)

        await supabase.from('post_visit_summaries').update({
          summary_text: parsed.summary_text || 'Consultation summary',
          medication_schedule: parsed.medication_schedule || 'Take as prescribed',
          follow_up_steps: parsed.follow_up_steps || 'Rest and follow up if needed',
          raw_llm_response: result.raw,
          status: 'completed'
        }).eq('appointment_id', appointmentId)

      } catch (llmErr) {
        console.error("LLM Post-visit summary generation failed:", llmErr)
        await supabase.from('post_visit_summaries').update({
          status: 'failed',
          raw_llm_response: String(llmErr)
        }).eq('appointment_id', appointmentId)
      }
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

interface LLMResult {
  text: string
  raw: string
}

async function callLLM(prompt: string, systemInstruction: string): Promise<LLMResult> {
  const provider = Deno.env.get("LLM_PROVIDER") || "gemini"
  const apiKey = Deno.env.get("LLM_API_KEY") || ""
  const model = Deno.env.get("LLM_MODEL") || (provider === "gemini" ? "gemini-1.5-flash" : "gpt-4o-mini")

  if (!apiKey) {
    throw new Error("Missing LLM_API_KEY environment variable")
  }

  if (provider === "gemini") {
    // Call Google Gemini API
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
    const body = {
      contents: [{
        parts: [{
          text: `${systemInstruction}\n\nUser request:\n${prompt}`
        }]
      }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Gemini API returned status ${res.status}: ${errText}`)
    }

    const data = await res.json()
    const textOutput = data.candidates?.[0]?.content?.parts?.[0]?.text || ""
    return {
      text: textOutput.trim(),
      raw: JSON.stringify(data)
    }

  } else if (provider === "openai") {
    // Call OpenAI API
    const url = "https://api.openai.com/v1/chat/completions"
    const body = {
      model: model,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`OpenAI API returned status ${res.status}: ${errText}`)
    }

    const data = await res.json()
    const textOutput = data.choices?.[0]?.message?.content || ""
    return {
      text: textOutput.trim(),
      raw: JSON.stringify(data)
    }

  } else {
    throw new Error(`Unsupported LLM provider: ${provider}`)
  }
}

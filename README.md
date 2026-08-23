# MediCare Connect - Healthcare Appointment Platform

MediCare Connect is a full-stack healthcare appointment management platform. It features three distinct portals for Patients, Doctors, and Administrators, utilizing Supabase for authentication, database storage, and Deno Edge Functions for LLM analysis, email notifications, and background cron jobs.

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org) (v18 or higher)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (optional, for deploying database schema and functions)

### Installation
1. Clone or extract the project source code to your workspace.
2. Install frontend dependencies:
   ```bash
   npm install
   ```
3. Copy the environment variables template and configure it:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` to include your Supabase project keys and Google Calendar client details.

4. Start the local frontend development server:
   ```bash
   npm run dev
   ```

---

## Database Schema & Migrations

The database is built on PostgreSQL with Row-Level Security (RLS) enabled. You can apply the initial schema file by copying the SQL from [init.sql](file:///Users/tanushrisukhwal/Desktop/HealthCare_Appointment_Manager/supabase/migrations/20260820000000_init.sql) and executing it in the Supabase SQL Editor:

- **`profiles`**: Stores roles (`patient`, `doctor`, `admin`) extending Supabase Auth.
- **`doctor_profiles`**: Specialized clinic configurations including active statuses, weekday schedules (JSON), and slot durations.
- **`doctor_leave_days`**: Calendar leaves logged by doctors or admins.
- **`appointments`**: Individual slot items which store statuses (`held`, `confirmed`, `completed`, `cancelled`) and `held_until` for reservations.
- **`symptom_forms`**: Patient-submitted symptoms.
- **`pre_visit_summaries`**: Urgencies, chief complaints, and AI-suggested physician questions.
- **`visit_notes`**: Doctor-submitted clinical notes and structured prescription lists (JSON).
- **`post_visit_summaries`**: AI translations of clinical prescriptions into patient-friendly summaries.
- **`notifications_log`**: Structured mailing backlog with statuses and retry counters.
- **`calendar_events`**: Relates appointments to patient and doctor Google Calendar event IDs.
- **`user_oauth_tokens`**: Securely holds Google OAuth access and refresh credentials.

---

## AI & LLM Integration

MediCare Connect uses Google Gemini (or OpenAI) to translate intake data and clinical charts.

### 1. Pre-Visit Summary Prompt
- **Trigger**: Patient completes symptom form checkouts.
- **System Instruction**:
  > You are an expert medical assistant. You MUST return a JSON object with EXACTLY the following keys: "urgency_level" (must be "Low", "Medium", or "High"), "chief_complaint" (string), and "suggested_questions" (an array of exactly 3 strings).
- **Prompt Template**:
  ```text
  Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor. Symptoms: Symptoms: <symptoms_text>, Severity: <severity>, Duration: <duration>
  ```

### 2. Post-Visit Summary Prompt
- **Trigger**: Doctor submits clinical notes + prescription checklist.
- **System Instruction**:
  > You are a compassionate doctor translating notes for patients. You MUST return a JSON object with EXACTLY the following keys: "summary_text" (patient-friendly wording of clinical notes), "medication_schedule" (schedule derived from the prescription), and "follow_up_steps" (what the patient should do next).
- **Prompt Template**:
  ```text
  Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps: Clinical Notes: <notes>. Prescriptions: <prescription_json>
  ```

---

## Google Calendar OAuth 2.0 Integration

To set up Calendar Sync:
1. Go to the [Google Cloud Console](https://console.cloud.google.com).
2. Create a Project, search for **Google Calendar API**, and click **Enable**.
3. Go to the **OAuth consent screen** tab, select **External**, configure basic application details, and add the scope: `.../auth/calendar.events`.
4. In the **Credentials** tab, click **Create Credentials** -> **OAuth client ID** (Web application).
5. Add **Authorized redirect URIs**:
   - Local: `http://localhost:5173/oauth/callback`
   - Production: `https://your-app-domain.com/oauth/callback`
6. Copy the Client ID to `VITE_GOOGLE_CLIENT_ID` in your `.env` file, and deploy the Client ID and Client Secret as secrets in your Supabase Edge Functions environment:
   ```bash
   supabase secrets set GOOGLE_CLIENT_ID="your-client-id" GOOGLE_CLIENT_SECRET="your-client-secret"
   ```

---

## System Design Note

### 1. Double-Booking Prevention

Concurrency conflicts in slot booking are prevented using a database-level partial unique index instead of weak, latency-prone application checks.

The following index is defined on the `appointments` table:
```sql
CREATE UNIQUE INDEX unique_active_doctor_slot 
ON public.appointments (doctor_id, slot_start) 
WHERE (status != 'cancelled');
```

This ensures that only one appointment for a specific doctor at a specific start time can have a status other than `'cancelled'`. If two patients simultaneously submit checkout inserts, PostgreSQL will evaluate the unique index constraint immediately. The transaction that reaches the database first is granted the lock and succeeds, while the concurrent transaction is rejected, throwing a unique constraint violation exception (`23505`). The client catches this error code and alerts the second patient to choose another timeslot.

### 2. Slot-Hold Mechanism

To prevent two patients from booking the same slot simultaneously while filling out symptom forms, the platform implements a 3-minute database-backed slot hold.

1. When a patient clicks an available slot on the calendar, the client inserts a row into `appointments` with `status = 'held'` and `held_until = NOW() + 3 minutes`.
2. Due to the partial unique index described above, this insert reserves the timeslot immediately. Any other patient attempting to hold the same slot will be rejected.
3. The patient is shown a countdown timer (3 minutes) while they complete the symptom intake form.
4. If they click "Confirm & Book", the status is updated to `'confirmed'` (and `held_until` is set to null), locking the slot permanently.
5. If the countdown expires or the user cancels the form, the application calls a cleanup query updating the status to `'cancelled'`, which releases the index lock and makes the timeslot instantly available to other searchers.
6. A background cron job scans and cancels any expired holds that failed to complete checkout due to closed tabs or abandoned sessions.

### 3. Doctor Leave-Day Conflict Handling

When a doctor logs a leave day, conflicts are handled atomically in the database using a PostgreSQL trigger:

```sql
CREATE OR REPLACE FUNCTION public.handle_doctor_leave_conflict()
RETURNS TRIGGER AS $$
BEGIN
  -- Log email cancellations for patients
  INSERT INTO public.notifications_log (appointment_id, type, channel, status, recipient_email, subject, body)
  SELECT a.id, 'leave_cancellation', 'email', 'pending', p.email, ...
  -- Update appointments to cancelled
  UPDATE public.appointments SET status = 'cancelled'
  WHERE doctor_id = NEW.doctor_id AND slot_start::date = NEW.date AND status IN ('held', 'confirmed');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

This trigger fires immediately after a leave is inserted. It cancels all conflicting `'held'` or `'confirmed'` appointments for that doctor on the specified date. In the same transaction, it queues cancellation notification payloads in the `notifications_log` table.

### 4. Notification Failure Retry & Backoff

To ensure email delivery reliability, the system decouples email dispatch from user actions using an asynchronous notifications ledger (`notifications_log`) and exponential backoff retry cron jobs.

1. Email requests are logged to the database as `status = 'pending'` and processed asynchronously.
2. The `background-jobs` edge function acts as a scheduler. It selects failed mail items (`status = 'failed' AND retry_count < 5`) and triggers their retry.
3. Retries use exponential backoff, delaying executions based on the value of `retry_count`.
4. If an email fails after 5 retries, the status is updated to `'failed'`, which surfaces a visual alert in the Admin Portal for administrator visibility.

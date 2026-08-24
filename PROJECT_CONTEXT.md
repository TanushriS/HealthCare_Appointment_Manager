# MediCare Connect - Comprehensive Project Context & History

This document serves as a complete summary of the project architecture, features, database setup, deployment configurations, and resolution history. You can open or paste this file directly into **Antigravity** on a new laptop to resume pair-programming with full context.

---

## 🚀 Live Links & Credentials

* **Live Application URL (Vercel)**: [https://health-care-appointment-manager.vercel.app](https://health-care-appointment-manager.vercel.app)
* **GitHub Repository**: [https://github.com/TanushriS/HealthCare_Appointment_Manager](https://github.com/TanushriS/HealthCare_Appointment_Manager)
* **Supabase Project Reference**: `jqnsbskilipyfblrvuik` (`https://jqnsbskilipyfblrvuik.supabase.co`)

---

## 🛠️ Tech Stack & Key Features

1. **Frontend**: React (Vite SPA) + Vanilla CSS (Custom Design Tokens, dark mode, glassmorphism aesthetics).
2. **Backend / Database**: PostgreSQL on Cloud Supabase with Row Level Security (RLS).
3. **Authentication**: Supabase Auth with dynamic role switching (Patient, Doctor, Admin).
4. **Google Calendar Integration**: 
   * Client-side Implicit OAuth Flow (`response_type=token`).
   * Direct browser-to-Google Calendar API sync (`/v3/calendars/primary/events`) bypassing missing edge function keys.
5. **Concurrency & Holds**:
   * Database-level partial unique index `unique_active_doctor_slot` to prevent double-bookings.
   * 3-minute slot hold reservation system during symptom checkout.
6. **Doctor Leave Management**: PostgreSQL trigger `handle_doctor_leave_conflict` automatically cancels conflicting appointments when a leave is logged.
7. **Vercel SPA Deployment**: Includes `vercel.json` rewrite rules (`"source": "/(.*)", "destination": "/index.html"`) for client-side routing.

---

## 🗄️ Database Setup (11 Tables Master Schema)

The full database migration is located in `supabase/migrations/20260820000000_init.sql`.

### Tables Created:
1. `profiles`: User accounts (`id`, `role`, `name`, `email`, `phone`). *Foreign key constraint `profiles_id_fkey` dropped for seamless admin provisioning.*
2. `doctor_profiles`: Clinic configurations, JSONB `working_hours`, `slot_duration`, `active` status.
3. `doctor_leave_days`: Calendar leaves logged by doctors or admins.
4. `appointments`: Slot items storing statuses (`held`, `confirmed`, `completed`, `cancelled`) and `held_until`.
5. `symptom_forms`: Pre-visit symptom intake.
6. `pre_visit_summaries`: AI-generated urgency levels, chief complaints, and suggested questions.
7. `visit_notes`: Doctor clinical notes and structured prescription checklists (JSONB).
8. `post_visit_summaries`: Patient-friendly summaries and medication schedules.
9. `notifications_log`: Async notification ledger with retry counters.
10. `calendar_events`: Google Calendar event mapping IDs.
11. `user_oauth_tokens`: User OAuth tokens (`user_id`, `access_token`, `expiry_time`).

### Critical SQL Commands Executed in Supabase:
```sql
-- 1. Enable table permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

-- 2. Drop foreign key constraint on profiles for admin doctor creation
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- 3. Apply public RLS policies across all tables
DO $$
DECLARE tbl text;
BEGIN
  FOR tbl IN SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Public access policy" ON public.%I', tbl);
    EXECUTE format('CREATE POLICY "Public access policy" ON public.%I FOR ALL TO public USING (true) WITH CHECK (true)', tbl);
  END LOOP;
END $$;
```

---

## 🔑 Environment Variables Setup (`.env`)

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://jqnsbskilipyfblrvuik.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_publishable_key

# Google OAuth Credentials
VITE_GOOGLE_CLIENT_ID=566652538659-5babo6b7cllfaueqkeme8nj21u2vno15.apps.googleusercontent.com
```

---

## 🌐 Google Cloud Console OAuth Configuration

* **Authorized JavaScript Origins**:
  * `http://localhost:5173`
  * `https://health-care-appointment-manager.vercel.app`
* **Authorized Redirect URIs**:
  * `http://localhost:5173/oauth/callback`
  * `https://health-care-appointment-manager.vercel.app/oauth/callback`

---

## 💻 How to Resume on New Laptop

1. **Clone Repo**:
   ```bash
   git clone https://github.com/TanushriS/HealthCare_Appointment_Manager.git
   cd HealthCare_Appointment_Manager
   npm install
   ```
2. **Re-create `.env`** with the variables above.
3. Open `HealthCare_Appointment_Manager` in **Antigravity IDE**.
4. Antigravity will automatically read this `PROJECT_CONTEXT.md` file and resume assisting you immediately!

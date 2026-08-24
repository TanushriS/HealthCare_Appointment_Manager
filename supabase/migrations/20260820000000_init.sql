-- Initialize schema for MediCare Connect

-- Create profiles table (extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('patient', 'doctor', 'admin')),
  name TEXT,
  email TEXT,
  phone TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Grants for public schema tables
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

-- Profiles Policies
CREATE POLICY "Allow public read access to profiles" 
  ON public.profiles FOR SELECT 
  TO public 
  USING (true);

CREATE POLICY "Allow users to insert own profile" 
  ON public.profiles FOR INSERT 
  TO public 
  WITH CHECK (true);

CREATE POLICY "Allow users to update own profile" 
  ON public.profiles FOR UPDATE 
  TO authenticated 
  USING (auth.uid() = id);

-- Create doctor profiles table
CREATE TABLE IF NOT EXISTS public.doctor_profiles (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  specialisation TEXT NOT NULL,
  working_hours JSONB NOT NULL, -- Format: { "monday": { "start": "09:00", "end": "17:00" }, ... }
  slot_duration INTEGER NOT NULL DEFAULT 30, -- in minutes
  active BOOLEAN NOT NULL DEFAULT true
);

-- Enable RLS on doctor_profiles
ALTER TABLE public.doctor_profiles ENABLE ROW LEVEL SECURITY;

-- Doctor Profiles Policies
CREATE POLICY "Allow public read access to doctor profiles" 
  ON public.doctor_profiles FOR SELECT 
  TO authenticated 
  USING (true);

CREATE POLICY "Allow admins full access to doctor profiles" 
  ON public.doctor_profiles FOR ALL 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Create doctor leave days table
CREATE TABLE IF NOT EXISTS public.doctor_leave_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  reason TEXT,
  UNIQUE(doctor_id, date)
);

-- Enable RLS on doctor_leave_days
ALTER TABLE public.doctor_leave_days ENABLE ROW LEVEL SECURITY;

-- Doctor Leave Days Policies
CREATE POLICY "Allow public read access to doctor leave days" 
  ON public.doctor_leave_days FOR SELECT 
  TO authenticated 
  USING (true);

CREATE POLICY "Allow doctors to manage own leave days" 
  ON public.doctor_leave_days FOR ALL 
  TO authenticated 
  USING (
    doctor_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Create appointments table
CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  slot_start TIMESTAMP WITH TIME ZONE NOT NULL,
  slot_end TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('held', 'confirmed', 'cancelled', 'completed')),
  held_until TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for preventing double-booking: Only allow one non-cancelled booking per doctor per slot_start
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_doctor_slot 
  ON public.appointments (doctor_id, slot_start) 
  WHERE (status != 'cancelled');

-- Enable RLS on appointments
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- Appointments Policies
CREATE POLICY "Allow patients to read own appointments" 
  ON public.appointments FOR SELECT 
  TO authenticated 
  USING (
    patient_id = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Allow doctors to read assigned appointments" 
  ON public.appointments FOR SELECT 
  TO authenticated 
  USING (
    doctor_id = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Allow patients to insert appointments" 
  ON public.appointments FOR INSERT 
  TO authenticated 
  WITH CHECK (patient_id = auth.uid());

CREATE POLICY "Allow users to update own appointments" 
  ON public.appointments FOR UPDATE 
  TO authenticated 
  USING (
    patient_id = auth.uid() OR 
    doctor_id = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Create symptom forms table
CREATE TABLE IF NOT EXISTS public.symptom_forms (
  appointment_id UUID PRIMARY KEY REFERENCES public.appointments(id) ON DELETE CASCADE,
  symptoms_text TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  duration TEXT NOT NULL
);

-- Enable RLS on symptom_forms
ALTER TABLE public.symptom_forms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow appointment participants to read symptom forms" 
  ON public.symptom_forms FOR SELECT 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.appointments a 
      WHERE a.id = appointment_id AND (a.patient_id = auth.uid() OR a.doctor_id = auth.uid())
    ) OR
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Allow patients to insert symptom forms" 
  ON public.symptom_forms FOR INSERT 
  TO authenticated 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.appointments a 
      WHERE a.id = appointment_id AND a.patient_id = auth.uid()
    )
  );

-- Create pre-visit summaries table
CREATE TABLE IF NOT EXISTS public.pre_visit_summaries (
  appointment_id UUID PRIMARY KEY REFERENCES public.appointments(id) ON DELETE CASCADE,
  urgency_level TEXT CHECK (urgency_level IN ('Low', 'Medium', 'High')),
  chief_complaint TEXT,
  suggested_questions JSONB,
  raw_llm_response TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed'))
);

-- Enable RLS on pre_visit_summaries
ALTER TABLE public.pre_visit_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow appointment participants to read pre-visit summaries" 
  ON public.pre_visit_summaries FOR SELECT 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.appointments a 
      WHERE a.id = appointment_id AND (a.patient_id = auth.uid() OR a.doctor_id = auth.uid())
    ) OR
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Create visit notes table
CREATE TABLE IF NOT EXISTS public.visit_notes (
  appointment_id UUID PRIMARY KEY REFERENCES public.appointments(id) ON DELETE CASCADE,
  clinical_notes TEXT NOT NULL,
  prescription JSONB -- Array of prescription objects
);

-- Enable RLS on visit_notes
ALTER TABLE public.visit_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow appointment participants to read visit notes" 
  ON public.visit_notes FOR SELECT 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.appointments a 
      WHERE a.id = appointment_id AND (a.patient_id = auth.uid() OR a.doctor_id = auth.uid())
    ) OR
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Allow doctors to insert/update visit notes" 
  ON public.visit_notes FOR ALL 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.appointments a 
      WHERE a.id = appointment_id AND a.doctor_id = auth.uid()
    )
  );

-- Create post-visit summaries table
CREATE TABLE IF NOT EXISTS public.post_visit_summaries (
  appointment_id UUID PRIMARY KEY REFERENCES public.appointments(id) ON DELETE CASCADE,
  summary_text TEXT,
  medication_schedule TEXT,
  follow_up_steps TEXT,
  raw_llm_response TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed'))
);

-- Enable RLS on post_visit_summaries
ALTER TABLE public.post_visit_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow appointment participants to read post-visit summaries" 
  ON public.post_visit_summaries FOR SELECT 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.appointments a 
      WHERE a.id = appointment_id AND (a.patient_id = auth.uid() OR a.doctor_id = auth.uid())
    ) OR
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Create notifications log table
CREATE TABLE IF NOT EXISTS public.notifications_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'in-app')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  retry_count INTEGER DEFAULT 0,
  recipient_email TEXT,
  subject TEXT,
  body TEXT,
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on notifications_log
ALTER TABLE public.notifications_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow admins to read all notifications log" 
  ON public.notifications_log FOR SELECT 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Create calendar events table
CREATE TABLE IF NOT EXISTS public.calendar_events (
  appointment_id UUID PRIMARY KEY REFERENCES public.appointments(id) ON DELETE CASCADE,
  patient_event_id TEXT,
  doctor_event_id TEXT,
  sync_status TEXT NOT NULL CHECK (sync_status IN ('synced', 'failed', 'pending')),
  error_message TEXT
);

-- Enable RLS on calendar_events
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow appointment participants to read calendar events" 
  ON public.calendar_events FOR SELECT 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.appointments a 
      WHERE a.id = appointment_id AND (a.patient_id = auth.uid() OR a.doctor_id = auth.uid())
    ) OR
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Create user OAuth tokens table
CREATE TABLE IF NOT EXISTS public.user_oauth_tokens (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expiry_time TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on user_oauth_tokens
ALTER TABLE public.user_oauth_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow users to manage own OAuth tokens" 
  ON public.user_oauth_tokens FOR ALL 
  TO authenticated 
  USING (user_id = auth.uid());

-- Triggers for User Syncing and Leave conflicts

-- 1. Trigger to create user profile upon auth.users insert
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'name', 'New User'),
    COALESCE(new.raw_user_meta_data->>'role', 'patient')
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Trigger to handle doctor leave conflicts
CREATE OR REPLACE FUNCTION public.handle_doctor_leave_conflict()
RETURNS TRIGGER AS $$
BEGIN
  -- Log notifications for cancelled appointments
  INSERT INTO public.notifications_log (appointment_id, type, channel, status, recipient_email, subject, body)
  SELECT 
    a.id,
    'leave_cancellation',
    'email',
    'pending',
    p.email,
    'Appointment Cancelled: Dr. ' || COALESCE(d.name, 'Doctor') || ' is on leave',
    'Dear ' || COALESCE(p.name, 'Patient') || ', your appointment with Dr. ' || COALESCE(d.name, 'Doctor') || ' on ' || NEW.date || ' at ' || to_char(a.slot_start, 'HH24:MI') || ' has been cancelled because the doctor is on leave. Please log in to rebook a different slot. Reason: ' || COALESCE(NEW.reason, 'Doctor on leave')
  FROM public.appointments a
  JOIN public.profiles p ON a.patient_id = p.id
  JOIN public.profiles d ON a.doctor_id = d.id
  WHERE a.doctor_id = NEW.doctor_id
    AND a.slot_start::date = NEW.date
    AND a.status IN ('held', 'confirmed');

  -- Also log notifications for doctors
  INSERT INTO public.notifications_log (appointment_id, type, channel, status, recipient_email, subject, body)
  SELECT 
    a.id,
    'leave_cancellation_doctor',
    'email',
    'pending',
    d.email,
    'Appointment Cancelled: You are marked on leave',
    'Hello Dr. ' || COALESCE(d.name, 'Doctor') || ', you have been marked on leave for ' || NEW.date || '. The appointment with ' || COALESCE(p.name, 'Patient') || ' at ' || to_char(a.slot_start, 'HH24:MI') || ' has been cancelled.'
  FROM public.appointments a
  JOIN public.profiles p ON a.patient_id = p.id
  JOIN public.profiles d ON a.doctor_id = d.id
  WHERE a.doctor_id = NEW.doctor_id
    AND a.slot_start::date = NEW.date
    AND a.status IN ('held', 'confirmed');

  -- Update appointments to 'cancelled'
  UPDATE public.appointments
  SET status = 'cancelled'
  WHERE doctor_id = NEW.doctor_id
    AND slot_start::date = NEW.date
    AND status IN ('held', 'confirmed');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER trg_handle_doctor_leave_conflict
  AFTER INSERT ON public.doctor_leave_days
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_doctor_leave_conflict();

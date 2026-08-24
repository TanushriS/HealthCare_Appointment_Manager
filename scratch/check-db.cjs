const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://jqnsbskilipyfblrvuik.supabase.co'
const supabaseAnonKey = 'sb_publishable_yIASqJPn7mZkV8auM-7PqQ_SkofNU6F'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function run() {
  console.log('Querying Supabase database...')
  
  const { data: doctors, error: docErr } = await supabase
    .from('doctor_profiles')
    .select('*, profile:profiles(name, email)')
  
  if (docErr) {
    console.error('Error fetching doctor_profiles:', docErr)
  } else {
    console.log('Doctor Profiles (Count:', doctors?.length, '):')
    console.log(JSON.stringify(doctors, null, 2))
  }

  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'doctor')

  if (profErr) {
    console.error('Error fetching doctor profiles:', profErr)
  } else {
    console.log('Profiles with role = doctor (Count:', profiles?.length, '):')
    console.log(JSON.stringify(profiles, null, 2))
  }
}

run()

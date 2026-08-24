const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://jqnsbskilipyfblrvuik.supabase.co'
const supabaseAnonKey = 'sb_publishable_yIASqJPn7mZkV8auM-7PqQ_SkofNU6F'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function run() {
  console.log('Querying Supabase database for admins...')
  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'admin')

  if (profErr) {
    console.error('Error fetching admin profiles:', profErr)
  } else {
    console.log('Profiles with role = admin (Count:', profiles?.length, '):')
    console.log(JSON.stringify(profiles, null, 2))
  }
}

run()

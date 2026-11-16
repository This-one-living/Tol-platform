import { randomBytes, randomInt } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL?.trim()
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your terminal environment before running this script.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const firstNames = [
  'Adaeze', 'Nneka', 'Chisom', 'Kelechi', 'Ezinne', 'Chidera', 'Uche', 'Ifeoma', 'Obinna', 'Chukwuemeka',
  'Amarachi', 'Somto', 'Chiamaka', 'Ifunanya', 'Nnamdi', 'Chibuzo', 'Onyeka', 'Ijeoma', 'Ugonna', 'Ebube',
]
const lastNames = [
  'Okoro', 'Nwankwo', 'Eze', 'Umeh', 'Ezeani', 'Nworie', 'Ogbu', 'Nwachukwu', 'Aja', 'Ezeh',
  'Onwe', 'Okafor', 'Mba', 'Nwobodo', 'Ekuma', 'Oko', 'Egwu', 'Nwali', 'Nwafor', 'Azu',
]
const templates = [
  { niche: 'Technology / Digital Innovation', category: 'Software Engineering', lga: 'Abakaliki', community: 'Abakaliki', skills: ['Web development', 'Database design'] },
  { niche: 'Creative Arts / Entertainment', category: 'Photography', lga: 'Afikpo North', community: 'Afikpo', skills: ['Portrait photography', 'Photo editing'] },
  { niche: 'Business / Entrepreneurship', category: 'Startup Founder', lga: 'Ikwo', community: 'Ezzamgbo', skills: ['Business planning', 'Sales'] },
  { niche: 'Health / Medicine', category: 'Nutrition', lga: 'Ezza South', community: 'Onueke', skills: ['Nutrition education', 'Wellness'] },
  { niche: 'Engineering', category: 'Civil Engineering', lga: 'Ohaozara', community: 'Uburu', skills: ['Site planning', 'Project management'] },
  { niche: 'Education / Research', category: 'Teaching', lga: 'Ohaukwu', community: 'Ezzamgbo', skills: ['Curriculum design', 'Mentoring'] },
  { niche: 'Agriculture / Agribusiness', category: 'Crop Farming', lga: 'Ivo', community: 'Isiaka', skills: ['Farm planning', 'Crop production'] },
  { niche: 'Food / Hospitality', category: 'Catering', lga: 'Onicha', community: 'Isu', skills: ['Catering', 'Event planning'] },
  { niche: 'Construction / Real Estate', category: 'Architecture', lga: 'Ezza North', community: 'Ebiaji', skills: ['Building design', 'Construction planning'] },
  { niche: 'Law / Governance', category: 'Legal Practice', lga: 'Izzi', community: 'Iboko', skills: ['Legal research', 'Policy'] },
  { niche: 'Science / Research', category: 'Environmental Science', lga: 'Ishielu', community: 'Ohofia', skills: ['Data analysis', 'Field research'] },
  { niche: 'Finance / Accounting', category: 'Accounting', lga: 'Ebonyi', community: 'Ezzamgbo', skills: ['Bookkeeping', 'Financial reporting'] },
  { niche: 'Media / Communication', category: 'Content Creation', lga: 'Afikpo South', community: 'Nguzu Edda', skills: ['Writing', 'Social media'] },
  { niche: 'Sports / Fitness', category: 'Coaching', lga: 'Abakaliki', community: 'Nkaliki', skills: ['Fitness coaching', 'Athletics'] },
  { niche: 'Fashion / Beauty', category: 'Fashion Design', lga: 'Ikwo', community: 'Noyo', skills: ['Fashion design', 'Textile work'] },
  { niche: 'Transportation / Logistics', category: 'Supply Chain', lga: 'Ohaozara', community: 'Okposi', skills: ['Logistics', 'Route planning'] },
  { niche: 'Skilled Trades', category: 'Electrical Work', lga: 'Ohaukwu', community: 'Ngbo', skills: ['Electrical installation', 'Maintenance'] },
  { niche: 'Students / Academic Development', category: 'Undergraduate Student', lga: 'Ezza South', community: 'Amagu', skills: ['Research', 'Academic mentoring'] },
  { niche: 'Personal Development', category: 'Leadership', lga: 'Onicha', community: 'Ukawu', skills: ['Public speaking', 'Leadership'] },
  { niche: 'Technology / Digital Innovation', category: 'Product Design', lga: 'Abakaliki', community: 'Ntezi', skills: ['UX research', 'Product design'] },
]

function shuffle(items) {
  const shuffled = [...items]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1)
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }
  return shuffled
}

const runId = randomBytes(4).toString('hex')
const phoneRunId = String(randomInt(1000, 10000))
const password = `${randomBytes(24).toString('hex')}aA1!`
const firstNameOrder = shuffle(firstNames)
const lastNameOrder = shuffle(lastNames)
const profileOrder = shuffle(templates)
const createdUsers = []

async function removeCreatedUsers() {
  const cleanupErrors = []
  for (const user of createdUsers.reverse()) {
    const { error: profileError } = await supabase.from('profiles').delete().eq('id', user.id)
    if (profileError) cleanupErrors.push(`Profile cleanup failed for ${user.email}: ${profileError.message}`)
    const { error: userError } = await supabase.auth.admin.deleteUser(user.id)
    if (userError) cleanupErrors.push(`Auth cleanup failed for ${user.email}: ${userError.message}`)
  }
  return cleanupErrors
}

try {
  for (let index = 0; index < 20; index += 1) {
    const fullName = `${firstNameOrder[index]} ${lastNameOrder[index]}`
    const email = `tol-test-${runId}-${String(index + 1).padStart(2, '0')}@example.com`
    const phone = `+234800${phoneRunId}${String(index + 1).padStart(3, '0')}`
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })

    if (error) throw new Error(`Could not create ${email}: ${error.message}`)
    if (!data.user) throw new Error(`Supabase did not return the account for ${email}.`)
    createdUsers.push({ id: data.user.id, email })

    const template = profileOrder[index]
    const { error: profileError } = await supabase.from('profiles').upsert({
      id: data.user.id,
      full_name: fullName,
      phone,
      state: 'Ebonyi',
      lga: template.lga,
      community: template.community,
      niche: template.niche,
      category: template.category,
      other_niche: null,
      interests: template.skills,
      skills: template.skills,
    }, { onConflict: 'id' })

    if (profileError) throw new Error(`Could not create the profile for ${email}: ${profileError.message}`)
  }

  console.log('Created 20 confirmed Supabase test accounts and profiles.')
  console.log(`Shared test password: ${password}`)
  console.log('Emails:')
  for (const user of createdUsers) console.log(user.email)
  console.log('Delete these accounts after testing; the shared password is printed only once.')
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Account seeding failed.')
  const cleanupErrors = await removeCreatedUsers()
  for (const cleanupError of cleanupErrors) console.error(cleanupError)
  if (createdUsers.length) console.error(`Attempted cleanup of ${createdUsers.length} accounts created during this run.`)
  process.exitCode = 1
}

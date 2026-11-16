import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { recordAccountActivity } from '../lib/activity'
import { EBONYI_LGAS, NICHES, NICHE_CATEGORIES } from '../data/reference'
import './Settings.css'

type ProfileForm = {
  full_name: string
  phone: string
  lga: string
  community: string
  niche: string
  category: string
  other_niche: string
  interests: string
  skills: string
}

type ProfileRecord = Omit<ProfileForm, 'interests' | 'skills'> & {
  interests: string[] | null
  skills: string[] | null
  avatar_url: string | null
}

type PageStatus = 'loading' | 'ready' | 'signed-out' | 'unconfigured' | 'error'

type ActivityRecord = {
  id: number
  event_type: string
  details: { group_type?: string; group_value?: string }
  created_at: string
}

const emptyProfile: ProfileForm = {
  full_name: '',
  phone: '',
  lga: '',
  community: '',
  niche: '',
  category: '',
  other_niche: '',
  interests: '',
  skills: '',
}

const listToInput = (values: string[] | null) => values?.join(', ') ?? ''
const inputToList = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean)

const activityDescription = (activity: ActivityRecord) => {
  switch (activity.event_type) {
    case 'account_created': return 'Created an account'
    case 'signed_in': return 'Signed in'
    case 'signed_out': return 'Signed out'
    case 'password_changed': return 'Changed the account password'
    case 'password_reset': return 'Reset the account password'
    case 'profile_updated': return 'Updated profile information'
    case 'profile_photo_updated': return 'Updated the profile photo'
    case 'joined_group': return `Joined the ${activity.details.group_type ?? ''} group ${activity.details.group_value ?? ''}`.trim()
    case 'left_group': return `Left the ${activity.details.group_type ?? ''} group ${activity.details.group_value ?? ''}`.trim()
    default: return 'Account activity'
  }
}

export default function Settings() {
  const [status, setStatus] = useState<PageStatus>(supabase ? 'loading' : 'unconfigured')
  const [userId, setUserId] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [profile, setProfile] = useState<ProfileForm>(emptyProfile)
  const [avatarUrl, setAvatarUrl] = useState('')
  const [photoPreview, setPhotoPreview] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileSuccess, setProfileSuccess] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')
  const [activities, setActivities] = useState<ActivityRecord[]>([])
  const [activityLoading, setActivityLoading] = useState(true)
  const [activityError, setActivityError] = useState('')
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [logoutError, setLogoutError] = useState('')

  const loadActivities = useCallback(async () => {
    if (!supabase) return
    const client = supabase
    try {
      const { data, error: loadError } = await client.rpc('get_my_activity', { result_limit: 50 })
      if (loadError) {
        setActivityError(loadError.message)
        return
      }
      setActivityError('')
      setActivities((data ?? []) as ActivityRecord[])
    } catch (loadError) {
      setActivityError(loadError instanceof Error ? loadError.message : 'Could not load account activity.')
    } finally {
      setActivityLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!photoPreview.startsWith('blob:')) return
    return () => URL.revokeObjectURL(photoPreview)
  }, [photoPreview])

  useEffect(() => {
    if (!supabase) return
    let active = true
    const client = supabase

    const loadProfile = async () => {
      try {
        const { data: userData, error: authError } = await client.auth.getUser()
        if (!active) return
        if (authError) {
          setProfileError(authError.message)
          setStatus('error')
          setProfileLoading(false)
          return
        }
        if (!userData.user) {
          setStatus('signed-out')
          setProfileLoading(false)
          return
        }

        setUserId(userData.user.id)
        setUserEmail(userData.user.email ?? '')
        const { data, error: profileError } = await client.rpc('get_my_profile')

        if (!active) return
        if (profileError) {
          setProfileError(profileError.message)
          setStatus('error')
          setProfileLoading(false)
          return
        }
        const record = (data?.[0] ?? null) as ProfileRecord | null
        if (!record) {
          setProfileError('Your profile could not be found. Complete your profile before editing it.')
          setStatus('error')
          setProfileLoading(false)
          return
        }

        setProfile({
          full_name: record.full_name ?? '',
          phone: record.phone ?? '',
          lga: record.lga ?? '',
          community: record.community ?? '',
          niche: record.niche ?? '',
          category: record.category ?? '',
          other_niche: record.other_niche ?? '',
          interests: listToInput(record.interests),
          skills: listToInput(record.skills),
        })
        setAvatarUrl(record.avatar_url ?? '')
        setPhotoPreview(record.avatar_url ?? '')
        setStatus('ready')
        setProfileLoading(false)
        void loadActivities()
      } catch (loadError) {
        if (!active) return
        setProfileError(loadError instanceof Error ? loadError.message : 'Could not load your profile.')
        setStatus('error')
        setProfileLoading(false)
      }
    }

    void loadProfile()
    return () => { active = false }
  }, [loadActivities])

  const setField = (field: keyof ProfileForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const value = event.target.value
      setProfile((current) => field === 'niche'
        ? { ...current, niche: value, category: '' }
        : { ...current, [field]: value })
      setProfileError('')
      setProfileSuccess('')
    }

  const handlePhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setProfileError('Choose a JPG, PNG, or WebP image.')
      event.target.value = ''
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setProfileError('Profile photos must be 5 MB or smaller.')
      event.target.value = ''
      return
    }
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
    setProfileError('')
    setProfileSuccess('')
  }

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setProfileError('')
    setProfileSuccess('')
    if (!supabase || !userId) return
    if (!/^(\+234|0)[789]\d{9}$/.test(profile.phone.replace(/\s/g, ''))) {
      setProfileError('Enter a valid Nigerian phone number.')
      return
    }

    setProfileBusy(true)
    const client = supabase
    try {
      let nextAvatarUrl = avatarUrl
      if (photoFile) {
        const path = `${userId}/avatar`
        const { error: uploadError } = await client.storage.from('profile-photos').upload(path, photoFile, {
          cacheControl: '3600',
          contentType: photoFile.type,
          upsert: true,
        })
        if (uploadError) {
          setProfileError(uploadError.message)
          return
        }
        const publicUrl = client.storage.from('profile-photos').getPublicUrl(path).data.publicUrl
        const photoUrl = new URL(publicUrl)
        photoUrl.searchParams.set('v', String(Date.now()))
        nextAvatarUrl = photoUrl.toString()
      }

      const { error: saveError } = await client.rpc('update_my_profile', {
        profile_data: {
          full_name: profile.full_name.trim(),
          phone: profile.phone.trim(),
          lga: profile.lga,
          community: profile.community.trim(),
          niche: profile.niche,
          category: profile.category || null,
          other_niche: profile.niche === 'Other' ? profile.other_niche.trim() || null : null,
          interests: inputToList(profile.interests),
          skills: inputToList(profile.skills),
          avatar_url: nextAvatarUrl || null,
        },
      })

      if (saveError) {
        setProfileError(saveError.message)
        return
      }

      setAvatarUrl(nextAvatarUrl)
      setPhotoPreview(nextAvatarUrl)
      const photoChanged = !!photoFile
      setPhotoFile(null)
      if (nextAvatarUrl) localStorage.setItem('tol_profile_photo', nextAvatarUrl)
      localStorage.setItem('tol_user_phone', profile.phone.replace(/\s+/g, ''))
      setProfileSuccess('Your profile has been updated.')
      const activityErrors = [await recordAccountActivity('profile_updated')]
      if (photoChanged) activityErrors.push(await recordAccountActivity('profile_photo_updated'))
      await loadActivities()
      const activityError = activityErrors.filter(Boolean).join('; ')
      if (activityError) setActivityError(`Profile saved, but activity could not be recorded: ${activityError}`)
    } catch (saveError) {
      setProfileError(saveError instanceof Error ? saveError.message : 'Could not save your profile.')
    } finally {
      setProfileBusy(false)
    }
  }

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPasswordError('')
    setPasswordSuccess('')
    if (!supabase || !userEmail) return
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.')
      return
    }

    setPasswordBusy(true)
    const client = supabase
    try {
      const { error: verifyError } = await client.auth.signInWithPassword({
        email: userEmail,
        password: currentPassword,
      })
      if (verifyError) {
        setPasswordError('Current password is incorrect.')
        return
      }

      const { error: updateError } = await client.auth.updateUser({ password: newPassword })
      if (updateError) {
        setPasswordError(updateError.message)
        return
      }
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordSuccess('Your password has been changed.')
      const activityError = await recordAccountActivity('password_changed')
      await loadActivities()
      if (activityError) setActivityError(`Password changed, but activity could not be recorded: ${activityError}`)
    } catch (changeError) {
      setPasswordError(changeError instanceof Error ? changeError.message : 'Could not change your password.')
    } finally {
      setPasswordBusy(false)
    }
  }

  const handleLogout = async () => {
    setLogoutError('')
    setLogoutBusy(true)
    if (supabase) {
      try {
        const activityError = await recordAccountActivity('signed_out')
        if (activityError) setLogoutError(`Activity could not be recorded: ${activityError}`)
        const { error: authError } = await supabase.auth.signOut()
        if (authError) {
          setLogoutError(authError.message)
          setLogoutBusy(false)
          return
        }
      } catch (authError) {
        setLogoutError(authError instanceof Error ? authError.message : 'Could not log out. Please try again.')
        setLogoutBusy(false)
        return
      }
    }

    localStorage.removeItem('tol_session')
    localStorage.removeItem('tol_profile_complete')
    localStorage.removeItem('tol_user_email')
    localStorage.removeItem('tol_user_phone')
    localStorage.removeItem('tol_user_password')
    localStorage.removeItem('tol_profile_photo')
    window.location.replace('/auth')
  }

  const categoryOptions = NICHE_CATEGORIES[profile.niche] ?? []

  return (
    <div className="settings-page">
      <header className="settings-heading">
        <h1>Settings</h1>
        <p className="muted">Manage your profile, password, and session.</p>
      </header>

      {status === 'loading' && <p>Loading account settings…</p>}
      {status === 'unconfigured' && (
        <p className="alert alert-error" role="alert">
          Profile editing and password changes require a Supabase connection.
        </p>
      )}
      {status === 'signed-out' && (
        <p className="alert alert-error" role="alert">
          <Link to="/auth">Log in</Link> to edit your profile or change your password.
        </p>
      )}
      {status === 'error' && <p className="alert alert-error" role="alert">{profileError}</p>}

      {status === 'ready' && !profileLoading && (
        <>
          <section className="card settings-card">
            <h2>Edit profile</h2>
            <p className="muted">Update the information other members see on your profile.</p>
            <form className="settings-form" onSubmit={saveProfile}>
              <div className="profile-photo-editor">
                {photoPreview
                  ? <img src={photoPreview} alt="Profile preview" />
                  : <div className="profile-photo-placeholder">{profile.full_name.slice(0, 1).toUpperCase() || '?'}</div>}
                <label className="btn btn-secondary btn-sm">
                  Change profile photo
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoChange} />
                </label>
                <small className="muted">JPG, PNG, or WebP. Up to 5 MB.</small>
              </div>

              <label>
                Full name
                <input required value={profile.full_name} onChange={setField('full_name')} />
              </label>
              <label>
                Phone number
                <input required type="tel" value={profile.phone} onChange={setField('phone')} />
              </label>
              <div className="row">
                <label>
                  LGA
                  <select required value={profile.lga} onChange={setField('lga')}>
                    <option value="">Select LGA</option>
                    {profile.lga && !EBONYI_LGAS.includes(profile.lga) && <option value={profile.lga}>{profile.lga}</option>}
                    {EBONYI_LGAS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label>
                  Community / town
                  <input required value={profile.community} onChange={setField('community')} />
                </label>
              </div>
              <label>
                Major niche
                <select required value={profile.niche} onChange={setField('niche')}>
                  <option value="">Select niche</option>
                  {NICHES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              {profile.niche === 'Other' ? (
                <label>
                  Describe your niche
                  <input required value={profile.other_niche} onChange={setField('other_niche')} />
                </label>
              ) : (
                <label>
                  Category / specialisation
                  <select value={profile.category} onChange={setField('category')} disabled={!profile.niche}>
                    <option value="">Select category</option>
                    {profile.category && !categoryOptions.includes(profile.category) && (
                      <option value={profile.category}>{profile.category}</option>
                    )}
                    {categoryOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
              )}
              <label>
                Interests (comma separated)
                <textarea rows={2} value={profile.interests} onChange={setField('interests')} />
              </label>
              <label>
                Skills (comma separated)
                <textarea rows={2} value={profile.skills} onChange={setField('skills')} />
              </label>
              {profileError && <p className="error" role="alert">{profileError}</p>}
              {profileSuccess && <p className="success" role="status">{profileSuccess}</p>}
              <button className="btn btn-primary" type="submit" disabled={profileBusy}>
                {profileBusy ? 'Saving profile…' : 'Save profile'}
              </button>
            </form>
          </section>

          <section className="card settings-card">
            <h2>Change password</h2>
            <p className="muted">Verify your current password before choosing a new one.</p>
            <form className="settings-form" onSubmit={changePassword}>
              <label>
                Current password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </label>
              <label>
                New password
                <input
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  required
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </label>
              <label>
                Confirm new password
                <input
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </label>
              {passwordError && <p className="error" role="alert">{passwordError}</p>}
              {passwordSuccess && <p className="success" role="status">{passwordSuccess}</p>}
              <button className="btn btn-primary" type="submit" disabled={passwordBusy}>
                {passwordBusy ? 'Changing password…' : 'Change password'}
              </button>
            </form>
          </section>

          <section className="card settings-card">
            <h2>Activity log</h2>
            <p className="muted">Recent sign-ins, profile and password changes, and group membership activity.</p>
            {activityError && <p className="error" role="alert">{activityError}</p>}
            {activityLoading && <p className="muted">Loading activity…</p>}
            {!activityLoading && !activityError && activities.length === 0 && (
              <p className="muted">No account activity has been recorded yet.</p>
            )}
            {!activityLoading && activities.length > 0 && (
              <ol className="activity-list">
                {activities.map((activity) => (
                  <li key={activity.id} className="activity-item">
                    <span className="activity-dot" aria-hidden="true" />
                    <div>
                      <p>{activityDescription(activity)}</p>
                      <time dateTime={activity.created_at}>{new Date(activity.created_at).toLocaleString()}</time>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}

      <section className="card settings-card settings-session">
        <h2>Session</h2>
        <p className="muted">Sign out from this device.</p>
        {logoutError && <p className="error" role="alert">{logoutError}</p>}
        <button className="btn btn-secondary" type="button" onClick={handleLogout} disabled={logoutBusy}>
          {logoutBusy ? 'Logging out…' : 'Log out'}
        </button>
      </section>
    </div>
  )
}

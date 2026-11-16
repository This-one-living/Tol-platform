import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { recordAccountActivity } from '../lib/activity'

type RecoveryStatus = 'checking' | 'ready' | 'expired' | 'unavailable'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<RecoveryStatus>(supabase ? 'checking' : 'unavailable')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase) return
    let active = true
    const client = supabase
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY' || session) setStatus('ready')
    })

    const checkSession = async () => {
      try {
        const { data, error: sessionError } = await client.auth.getSession()
        if (!active) return
        if (sessionError) {
          setError(sessionError.message)
          setStatus('expired')
        } else {
          setStatus(data.session ? 'ready' : 'expired')
        }
      } catch (sessionError) {
        if (!active) return
        setError(sessionError instanceof Error ? sessionError.message : 'Could not validate this reset link.')
        setStatus('expired')
      }
    }

    void checkSession()
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (!supabase) {
      setError('Password recovery is unavailable while the app is in local demo mode.')
      return
    }

    setBusy(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(updateError.message)
        return
      }

      const activityError = await recordAccountActivity('password_reset')
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) {
        setError(`Your password was updated, but sign out failed: ${signOutError.message}`)
        return
      }

      localStorage.removeItem('tol_session')
      localStorage.removeItem('tol_profile_complete')
      if (activityError) setError(`Password reset, but activity could not be recorded: ${activityError}`)
      navigate('/auth', { replace: true })
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not reset your password.')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'checking') {
    return <div className="tol-form" style={{ maxWidth: 480, padding: '48px 0' }}><p>Validating reset link…</p></div>
  }

  if (status === 'unavailable') {
    return (
      <div className="tol-form" style={{ maxWidth: 480, padding: '48px 0' }}>
        <h1>Password reset unavailable</h1>
        <p className="error">Password recovery requires a Supabase connection.</p>
        <Link to="/auth">Back to login</Link>
      </div>
    )
  }

  if (status === 'expired') {
    return (
      <div className="tol-form" style={{ maxWidth: 480, padding: '48px 0' }}>
        <h1>Reset link expired</h1>
        {error && <p className="error" role="alert">{error}</p>}
        <p className="muted">Request a new password reset link to continue.</p>
        <Link to="/forgot-password">Request another link</Link>
      </div>
    )
  }

  return (
    <div className="tol-form" style={{ maxWidth: 480, padding: '48px 0' }}>
      <h1>Choose a new password</h1>
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
        <label>
          New password
          <input
            type="password"
            minLength={8}
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
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
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? 'Updating password…' : 'Update password'}
        </button>
      </form>
    </div>
  )
}

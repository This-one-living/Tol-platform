import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Auth() {
  const navigate = useNavigate()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')

    if (!identifier.trim()) {
      return setError('Enter your email or phone number.')
    }

    if (!password) {
      return setError('Enter your password.')
    }

    const value = identifier.trim()
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    const isPhone = /^(\+234|0)[789]\d{9}$/.test(value.replace(/\s+/g, ''))

    if (supabase && !isEmail) {
      return setError('Use the email address you registered with to sign in.')
    }

    if (!isEmail && !isPhone) {
      return setError('Use a valid email address or Nigerian phone number.')
    }

    setBusy(true)

    if (supabase) {
      try {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: value.toLowerCase(),
          password,
        })

        if (authError) {
          if (authError.message.toLowerCase().includes('email not confirmed')) {
            setError('Confirm your email address before signing in.')
          } else if (authError.message.toLowerCase().includes('invalid login credentials')) {
            setError('Email or password is incorrect.')
          } else {
            setError(authError.message)
          }
          return
        }

        localStorage.removeItem('tol_user_password')
        localStorage.setItem('tol_profile_complete', 'true')
        localStorage.setItem('tol_session', 'true')
        navigate('/home', { replace: true })
      } catch (authError) {
        setError(authError instanceof Error ? authError.message : 'Could not sign in. Please try again.')
      } finally {
        setBusy(false)
      }
      return
    }

    const storedEmail = localStorage.getItem('tol_user_email')
    const storedPhone = localStorage.getItem('tol_user_phone')
    const storedPassword = localStorage.getItem('tol_user_password')

    const validEmail = storedEmail ? value.toLowerCase() === storedEmail.toLowerCase() : false
    const validPhone = storedPhone ? value.replace(/\s+/g, '') === storedPhone.replace(/\s+/g, '') : false

    if ((storedEmail && !validEmail && storedPhone && !validPhone) || (!storedEmail && !storedPhone)) {
      setBusy(false)
      return setError('No account matches that email or phone number yet.')
    }

    const credentialsMatch = storedPassword ? password === storedPassword : false

    if (!credentialsMatch) {
      setBusy(false)
      return setError('Incorrect password. Please try again.')
    }

    localStorage.setItem('tol_profile_complete', 'true')
    localStorage.setItem('tol_session', 'true')
    setBusy(false)
    navigate('/home', { replace: true })
  }

  return (
    <div className="tol-form" style={{ maxWidth: 480, padding: '48px 0' }}>
      <h1>Welcome to The One Living</h1>
      <p className="muted">
        {supabase
          ? 'Sign in with the email address and password you registered with.'
          : 'Sign in with your email or phone number and password.'}
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
        <label>
          {supabase ? 'Email address' : 'Email or phone number'}
          <input
            type="text"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder={supabase ? 'you@example.com' : 'you@example.com or 0803...'}
            autoComplete="username"
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            autoComplete="current-password"
          />
        </label>

        <Link to="/forgot-password" className="muted" style={{ justifySelf: 'end' }}>
          Forgot password?
        </Link>

        {error ? <p className="error" role="alert">{error}</p> : null}

        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? 'Signing in...' : 'Log in'}
        </button>
      </form>

      <Link to="/signup" className="btn btn-secondary" style={{ textAlign: 'center', textDecoration: 'none' }}>
        Create account
      </Link>

      <p className="muted">
        New here? Start with your profile and continue to your home feed.
      </p>
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const getPasswordResetRedirectUrl = () => {
  const isLocalDevelopment = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  const origin = isLocalDevelopment ? window.location.origin : 'https://thisoneliving.com'
  return new URL('/reset-password', origin).toString()
}

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    if (!supabase) {
      setError('Password recovery is unavailable while the app is in local demo mode.')
      return
    }

    setBusy(true)
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: getPasswordResetRedirectUrl(),
      })
      if (resetError) {
        const message = resetError.message
        setError(
          /redirect|url.*not allowed/i.test(message)
            ? 'Supabase is not allowing this reset link destination. Set the Supabase Site URL to https://thisoneliving.com and add https://thisoneliving.com/reset-password to the Auth redirect URL allowlist. For local development, also allow your localhost reset-password URL.'
            : message,
        )
      } else {
        setSent(true)
      }
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Could not request a password reset.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tol-form" style={{ maxWidth: 480, padding: '48px 0' }}>
      <h1>Forgot password?</h1>
      {sent ? (
        <>
          <p className="muted" role="status">
            If an account exists for that email, a password reset link has been sent.
          </p>
          <Link to="/auth" className="btn btn-secondary">Back to login</Link>
        </>
      ) : (
        <>
          <p className="muted">Enter the email address on your account and we’ll send a reset link.</p>
          <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
            <label>
              Email address
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? 'Sending link…' : 'Send reset link'}
            </button>
          </form>
          <p className="muted"><Link to="/auth">Back to login</Link></p>
        </>
      )}
    </div>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Settings() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleLogout = async () => {
    setError('')
    setBusy(true)
    if (supabase) {
      try {
        const { error: authError } = await supabase.auth.signOut()
        if (authError) {
          setError(authError.message)
          setBusy(false)
          return
        }
      } catch (authError) {
        setError(authError instanceof Error ? authError.message : 'Could not log out. Please try again.')
        setBusy(false)
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

  return (
    <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1>Settings</h1>
      <p className="muted">Manage your account and session.</p>

      <div style={{ marginTop: 24, display: 'grid', gap: 12 }}>
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/home')}>
          Back to home
        </button>

        {error && <p className="error" role="alert">{error}</p>}

        <button type="button" className="btn btn-primary" onClick={handleLogout} disabled={busy}>
          {busy ? 'Logging out...' : 'Log out'}
        </button>
      </div>
    </div>
  )
}

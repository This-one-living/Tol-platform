import { useNavigate } from 'react-router-dom'

export default function Settings() {
  const navigate = useNavigate()

  const handleLogout = () => {
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

        <button type="button" className="btn btn-primary" onClick={handleLogout}>
          Log out
        </button>
      </div>
    </div>
  )
}

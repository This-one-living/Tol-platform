import { Link } from 'react-router-dom'

export default function Auth() {
  const continueDemoLogin = () => {
    localStorage.setItem('tol_profile_complete', 'true')
    localStorage.setItem('tol_session', 'true')
    window.location.href = '/home'
  }

  return (
    <div className="tol-form" style={{ maxWidth: 480, padding: '48px 0' }}>
      <h1>Welcome to The One Living</h1>
      <p className="muted">
        Sign in to keep building your community or create a profile to begin your journey.
      </p>

      <button className="btn-primary" type="button" onClick={continueDemoLogin}>
        Log in
      </button>

      <Link to="/signup" className="btn btn-secondary" style={{ textAlign: 'center', textDecoration: 'none' }}>
        Create account
      </Link>

      <p className="muted">
        New here? Start with your profile and continue to your home feed.
      </p>
    </div>
  )
}

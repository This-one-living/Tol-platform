import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Compass, MessageCircle, UsersRound } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { recordAccountActivity } from '../lib/activity'
import communityPhoto from '../assets/community-devices.jpg'
import './Auth.css'

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
        const activityError = await recordAccountActivity('signed_in')
        if (activityError) setError(`Signed in, but activity could not be recorded: ${activityError}`)
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
    <main className="login-page">
      <header className="login-topbar">
        <Link className="login-brand" to="/auth" aria-label="This One Living home">
          <span className="login-brand-mark">T</span>
          <span>This One Living</span>
        </Link>
        <p>New to TOL? <Link to="/signup">Create an account</Link></p>
      </header>

      <section className="login-hero" aria-labelledby="login-hero-title">
        <div className="login-story">
          <p className="login-eyebrow">YOUR PEOPLE. YOUR PLACE TO GROW.</p>
          <h1 id="login-hero-title">Great things happen when we <span>grow together.</span></h1>
          <p className="login-story-copy">
            Meet people across Ebonyi State, share what you know, and find new
            opportunities in a community built to help everyone move forward.
          </p>
          <div className="login-illustration-wrap">
            <img
              className="login-photo"
              src={communityPhoto}
              alt="Two young Black people in Lagos using smartphones and smiling together"
            />
            <div className="login-image-caption">
              <span className="login-caption-icon"><UsersRound size={18} /></span>
              <span><strong>Rooted in community</strong><small>Connected across Ebonyi</small></span>
            </div>
            <a
              className="login-photo-credit"
              href="https://unsplash.com/photos/a-man-and-a-woman-looking-at-a-cell-phone-O8SpYxOFnK8"
              target="_blank"
              rel="noreferrer"
            >
              Photo by Francis Odeyemi on Unsplash
            </a>
          </div>
        </div>

        <section className="login-card" aria-labelledby="login-form-title">
          <div className="login-card-heading">
            <p className="login-card-kicker">WELCOME BACK</p>
            <h2 id="login-form-title">Log in to your account</h2>
            <p className="login-card-copy">
              {supabase
                ? 'Sign in with the email address and password you registered with.'
                : 'Sign in with your email or phone number and password.'}
            </p>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
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

            <Link to="/forgot-password" className="login-forgot">
              Forgot password?
            </Link>

            {error ? <p className="error" role="alert">{error}</p> : null}

            <button className="btn btn-primary login-submit" type="submit" disabled={busy}>
              {busy ? 'Signing in...' : 'Log in'}
            </button>
          </form>

          <div className="login-card-divider"><span>OR</span></div>
          <Link to="/signup" className="btn btn-secondary login-create-account">
            Create an account
          </Link>
          <p className="login-privacy-note">Your community is one sign-in away.</p>
        </section>
      </section>

      <section className="login-about" aria-labelledby="login-about-title">
        <div className="login-about-heading">
          <p className="login-eyebrow">A COMMUNITY THAT MOVES WITH YOU</p>
          <h2 id="login-about-title">Your next opportunity could be just one connection away.</h2>
          <p>
            This One Living brings people and ideas together, helping you discover
            local talent, build meaningful relationships, and create new possibilities.
          </p>
        </div>
        <div className="login-feature-grid">
          <article className="login-feature">
            <span className="login-feature-icon"><UsersRound size={22} /></span>
            <h3>Find your people</h3>
            <p>Connect with members who share your interests, skills, and community.</p>
          </article>
          <article className="login-feature">
            <span className="login-feature-icon"><Compass size={22} /></span>
            <h3>Discover new paths</h3>
            <p>Explore the people, groups, and ideas creating momentum across Ebonyi.</p>
          </article>
          <article className="login-feature">
            <span className="login-feature-icon"><MessageCircle size={22} /></span>
            <h3>Grow together</h3>
            <p>Share knowledge, start conversations, and turn connections into progress.</p>
          </article>
        </div>
      </section>

      <footer className="login-footer">
        <span>This One Living</span>
        <span>Connecting people. Creating possibilities.</span>
      </footer>
    </main>
  )
}

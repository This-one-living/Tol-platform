import { Link } from 'react-router-dom'

const stats = [
  { value: '0', label: 'Connections' },
  { value: '0', label: 'Pending requests' },
  { value: '0', label: 'Unread messages' },
  { value: '0', label: 'Token Coins' },
]

const suggestions = [
  { name: 'Chinedu Okeke', meta: 'Civil engineer · Abakaliki', tag: 'Engineering' },
  { name: 'Ngozi Eze', meta: 'Teacher · Afikpo', tag: 'Education' },
  { name: 'Emeka Nwankwo', meta: 'Farmer · Ohaozara', tag: 'Agriculture' },
]

const initials = (name: string) =>
  name.split(' ').map((n) => n[0]).join('').slice(0, 2)

export default function Home() {
  const profilePhoto = localStorage.getItem('tol_profile_photo') || '';

  return (
    <>
      <section className="hero">
        <h1>Welcome back</h1>
        <p>
          Meet professionals across Ebonyi State, build your network and grow
          together.
        </p>
        <div className="hero-actions">
          <Link to="/discover" className="btn btn-primary">
            Find people
          </Link>
          {profilePhoto && (
            <img
              src={profilePhoto}
              alt="Profile"
              style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.7)' }}
            />
          )}
        </div>
      </section>

      <section className="stats-grid">
        {stats.map((s) => (
          <div className="card" key={s.label}>
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </section>

      <section>
        <div className="section-head">
          <h2>People you may know</h2>
          <Link to="/discover">See all</Link>
        </div>
        <div className="card-grid">
          {suggestions.map((p) => (
            <div className="card person" key={p.name}>
              <div className="person-head">
                <div className="avatar">{initials(p.name)}</div>
                <div>
                  <p className="person-name">{p.name}</p>
                  <p className="person-meta">{p.meta}</p>
                </div>
              </div>
              <span className="tag">{p.tag}</span>
              <button className="btn btn-secondary btn-sm">Connect</button>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

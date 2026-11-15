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
  return (
    <>
      <section className="hero">
        <h1>Welcome to The One Living</h1>
        <p>
          Meet professionals across Ebonyi State, build your network and grow
          together.
        </p>
        <div className="hero-actions">
          <a href="/discover" className="btn btn-primary">
            Find people
          </a>
          <a href="/signup" className="btn btn-secondary">
            Complete your profile
          </a>
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
          <a href="/discover">See all</a>
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

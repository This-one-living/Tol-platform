import { Link } from 'react-router-dom'

const people = [
  {
    name: 'Chinedu Okeke',
    role: 'Civil engineer',
    location: 'Abakaliki',
    niche: 'Engineering',
    skills: ['Site planning', 'Project management'],
  },
  {
    name: 'Ngozi Eze',
    role: 'Teacher',
    location: 'Afikpo North',
    niche: 'Education / Research',
    skills: ['Curriculum', 'Mentorship'],
  },
  {
    name: 'Emeka Nwankwo',
    role: 'Agribusiness specialist',
    location: 'Ohaozara',
    niche: 'Agriculture / Agribusiness',
    skills: ['Farm planning', 'Agro logistics'],
  },
  {
    name: 'Aisha Ogbonna',
    role: 'Product designer',
    location: 'Ikwo',
    niche: 'Technology / Digital Innovation',
    skills: ['UX research', 'Brand systems'],
  },
  {
    name: 'Uchenna Aja',
    role: 'Lawyer',
    location: 'Ezza South',
    niche: 'Law / Governance',
    skills: ['Contracts', 'Policy'],
  },
  {
    name: 'Mariam Ede',
    role: 'Nutritionist',
    location: 'Onicha',
    niche: 'Health / Medicine',
    skills: ['Wellness', 'Community health'],
  },
]

const initials = (name: string) =>
  name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

export default function Discover() {
  return (
    <>
      <div className="topbar">
        <div>
          <h1>Discover people</h1>
        </div>
        <Link to="/signup" className="btn btn-primary btn-sm">
          Complete profile
        </Link>
      </div>

      <div className="filters">
        <input type="text" placeholder="Search by name, skill or community" />
        <select defaultValue="all">
          <option value="all">All niches</option>
          <option value="eng">Engineering</option>
          <option value="edu">Education</option>
          <option value="agri">Agriculture</option>
          <option value="tech">Technology</option>
        </select>
        <select defaultValue="all">
          <option value="all">Any LGA</option>
          <option value="abakaliki">Abakaliki</option>
          <option value="afikpo">Afikpo North</option>
          <option value="ohaozara">Ohaozara</option>
        </select>
      </div>

      <div className="people-grid">
        {people.map((person) => (
          <article key={person.name} className="person-card card">
            <div className="avatar">{initials(person.name)}</div>
            <div>
              <h3>{person.name}</h3>
              <p className="person-meta">
                {person.role} · {person.location}
              </p>
              <p className="tag">{person.niche}</p>
              <div className="stat-row">
                {person.skills.map((skill) => (
                  <span key={skill} className="tag">
                    {skill}
                  </span>
                ))}
              </div>
              <button className="btn btn-secondary btn-sm" type="button">
                Connect
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  )
}

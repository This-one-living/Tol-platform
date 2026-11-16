import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { EBONYI_LGAS, NICHES } from '../data/reference'

type DiscoverProfile = {
  profile_id: string
  full_name: string
  niche: string | null
  category: string | null
  other_niche: string | null
  lga: string | null
  community: string | null
  skills: string[]
}

type PageStatus = 'loading' | 'ready' | 'signed-out' | 'unconfigured' | 'error'

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase()

export default function Discover() {
  const [status, setStatus] = useState<PageStatus>(supabase ? 'loading' : 'unconfigured')
  const [userId, setUserId] = useState('')
  const [search, setSearch] = useState('')
  const [niche, setNiche] = useState('')
  const [lga, setLga] = useState('')
  const [profiles, setProfiles] = useState<DiscoverProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    let active = true
    const client = supabase

    const loadUser = async () => {
      try {
        const { data, error: authError } = await client.auth.getUser()
        if (!active) return
        if (authError) {
          setError(authError.message)
          setStatus('error')
        } else if (data.user) {
          setUserId(data.user.id)
          setStatus('ready')
        } else {
          setStatus('signed-out')
        }
      } catch (authError) {
        if (!active) return
        setError(authError instanceof Error ? authError.message : 'Could not load your account.')
        setStatus('error')
      }
    }

    void loadUser()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!supabase || status !== 'ready' || !userId) return
    let active = true
    const client = supabase
    const timeout = window.setTimeout(async () => {
      try {
        const { data, error: searchError } = await client.rpc('search_discover_profiles', {
          search_text: search.trim(),
          niche_filter: niche || null,
          lga_filter: lga || null,
        })
        if (!active) return
        if (searchError) {
          setProfiles([])
          setError(searchError.message)
          return
        }
        setProfiles((data ?? []) as DiscoverProfile[])
      } catch (searchError) {
        if (!active) return
        setProfiles([])
        setError(searchError instanceof Error ? searchError.message : 'Could not search member profiles.')
      } finally {
        if (active) setLoading(false)
      }
    }, 250)

    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [lga, niche, search, status, userId])

  const updateSearch = (value: string) => {
    setSearch(value)
    setLoading(true)
    setError('')
  }

  const updateNiche = (value: string) => {
    setNiche(value)
    setLoading(true)
    setError('')
  }

  const updateLga = (value: string) => {
    setLga(value)
    setLoading(true)
    setError('')
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Discover people</h1>
          <p className="muted">Find members by name, skill, or community.</p>
        </div>
        <Link to="/signup" className="btn btn-primary btn-sm">
          Complete profile
        </Link>
      </div>

      <div className="filters">
        <input
          type="search"
          value={search}
          onChange={(event) => updateSearch(event.target.value)}
          placeholder="Search by name, skill or community"
          aria-label="Search members by name, skill, or community"
        />
        <select value={niche} onChange={(event) => updateNiche(event.target.value)} aria-label="Filter by niche">
          <option value="">All niches</option>
          {NICHES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={lga} onChange={(event) => updateLga(event.target.value)} aria-label="Filter by LGA">
          <option value="">Any LGA</option>
          {EBONYI_LGAS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>

      {status === 'unconfigured' && (
        <p className="alert alert-error" role="alert">Member search needs a connection to the account database.</p>
      )}
      {status === 'signed-out' && (
        <p className="alert alert-error" role="alert">
          <Link to="/auth">Log in</Link> to discover other members.
        </p>
      )}
      {status === 'error' && <p className="alert alert-error" role="alert">{error}</p>}
      {status === 'ready' && error && <p className="alert alert-error" role="alert">{error}</p>}

      {status === 'ready' && (
        <>
          <p className="muted" aria-live="polite">
            {loading ? 'Searching members…' : `${profiles.length} ${profiles.length === 1 ? 'member' : 'members'} found`}
          </p>
          {!loading && profiles.length === 0 && (
            <div className="card">
              <h2>No members found</h2>
              <p className="muted">
                {search.trim()
                  ? `No members match “${search.trim()}”. Try another name, skill, or community.`
                  : 'There are no other member profiles matching these filters yet.'}
              </p>
            </div>
          )}
          {loading && profiles.length === 0 && <p className="muted">Loading member profiles…</p>}

          <div className="people-grid">
            {!loading && profiles.map((profile) => {
              const role = profile.category || profile.other_niche || profile.niche || 'TOL member'
              const location = [profile.community, profile.lga].filter(Boolean).join(' · ')
              return (
                <article key={profile.profile_id} className="person-card card">
                  <div className="avatar">{initials(profile.full_name)}</div>
                  <div>
                    <h3>{profile.full_name}</h3>
                    <p className="person-meta">{role}{location ? ` · ${location}` : ''}</p>
                    <p className="tag">{profile.niche || 'Member'}</p>
                    {!!profile.skills?.length && (
                      <div className="stat-row">
                        {profile.skills.map((skill) => <span key={skill} className="tag">{skill}</span>)}
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}

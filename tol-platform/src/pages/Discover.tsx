import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, UserPlus, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { EBONYI_LGAS, NICHES } from '../data/reference'
import './Discover.css'

type DiscoverProfile = {
  profile_id: string
  network_status: 'none' | 'request_sent' | 'request_received' | 'connected'
  full_name: string
  niche: string | null
  category: string | null
  other_niche: string | null
  lga: string | null
  community: string | null
  skills: string[]
}

type NetworkRequest = {
  request_id: string
  requester_id: string
  full_name: string
  niche: string | null
  lga: string | null
  created_at: string
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
  const [requests, setRequests] = useState<NetworkRequest[]>([])
  const [requestsLoading, setRequestsLoading] = useState(false)
  const [requestsError, setRequestsError] = useState('')
  const [requestBusyId, setRequestBusyId] = useState('')
  const discoverProfiles = profiles.filter((profile) => profile.network_status !== 'request_received')

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
        setError('')
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

  useEffect(() => {
    if (!supabase || status !== 'ready' || !userId) return
    let active = true
    const client = supabase

    const loadRequests = async () => {
      setRequestsLoading(true)
      setRequestsError('')
      try {
        const { data, error: loadError } = await client.rpc('get_my_network_requests')
        if (!active) return
        if (loadError) {
          setRequestsError(loadError.message)
          return
        }
        setRequests((data ?? []) as NetworkRequest[])
      } catch (loadError) {
        if (!active) return
        setRequestsError(loadError instanceof Error ? loadError.message : 'Could not load network requests.')
      } finally {
        if (active) setRequestsLoading(false)
      }
    }

    void loadRequests()
    return () => { active = false }
  }, [status, userId])

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

  const addToNetwork = async (profileId: string) => {
    if (!supabase || requestBusyId) return
    const client = supabase
    setRequestBusyId(profileId)
    setRequestsError('')
    try {
      const { error: sendError } = await client.rpc('send_network_request', {
        p_recipient: profileId,
      })
      if (sendError) {
        setRequestsError(sendError.message)
        return
      }
      setProfiles((current) => current.map((profile) =>
        profile.profile_id === profileId ? { ...profile, network_status: 'request_sent' } : profile,
      ))
    } catch (sendError) {
      setRequestsError(sendError instanceof Error ? sendError.message : 'Could not send this network request.')
    } finally {
      setRequestBusyId('')
    }
  }

  const respondToRequest = async (request: NetworkRequest, accept: boolean) => {
    if (!supabase || requestBusyId) return
    const client = supabase
    setRequestBusyId(request.request_id)
    setRequestsError('')
    try {
      const { error: responseError } = await client.rpc('respond_network_request', {
        p_request: request.request_id,
        p_accept: accept,
      })
      if (responseError) {
        setRequestsError(responseError.message)
        return
      }
      setRequests((current) => current.filter((item) => item.request_id !== request.request_id))
      setProfiles((current) => current.map((profile) =>
        profile.profile_id === request.requester_id
          ? { ...profile, network_status: accept ? 'connected' : 'none' }
          : profile,
      ))
    } catch (responseError) {
      setRequestsError(responseError instanceof Error ? responseError.message : 'Could not respond to this request.')
    } finally {
      setRequestBusyId('')
    }
  }

  return (
    <section className="discover-page">
      <header className="discover-heading">
        <div>
          <h1>Discover people</h1>
          <p className="muted">Find members by name, skill, or community.</p>
        </div>
        <Link to="/signup" className="btn btn-primary btn-sm">Complete profile</Link>
      </header>

      {status === 'unconfigured' && (
        <p className="alert alert-error" role="alert">Member search needs a connection to the account database.</p>
      )}
      {status === 'signed-out' && (
        <p className="alert alert-error" role="alert"><Link to="/signup">Sign up</Link> to discover other members.</p>
      )}
      {status === 'error' && <p className="alert alert-error" role="alert">{error}</p>}

      {status === 'ready' && (
        <>
          <section className="discover-requests" aria-labelledby="discover-requests-title">
            <div className="discover-requests-heading">
              <div>
                <p className="discover-requests-eyebrow">YOUR NETWORK</p>
                <h2 id="discover-requests-title">Network requests</h2>
                <p className="muted">People who want to connect with you.</p>
              </div>
              {requests.length > 0 && (
                <span className="discover-request-count" aria-label={`${requests.length} pending requests`}>
                  {requests.length}
                </span>
              )}
            </div>

            {requestsLoading && <p className="muted" role="status">Loading network requests…</p>}
            {requestsError && <p className="alert alert-error" role="alert">{requestsError}</p>}
            {!requestsLoading && !requestsError && requests.length === 0 && (
              <p className="discover-requests-empty">You don’t have any pending network requests.</p>
            )}
            {!requestsLoading && !requestsError && requests.length > 0 && (
              <div className="discover-request-list">
                {requests.map((request) => (
                  <article className="discover-request-card" key={request.request_id}>
                    <div className="avatar">{initials(request.full_name)}</div>
                    <div className="discover-request-copy">
                      <strong>{request.full_name}</strong>
                      <span className="person-meta">
                        {[request.niche, request.lga].filter(Boolean).join(' · ') || 'TOL member'}
                      </span>
                    </div>
                    <div className="discover-request-actions">
                      <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        disabled={!!requestBusyId}
                        onClick={() => void respondToRequest(request, true)}
                      >
                        <Check size={16} />
                        {requestBusyId === request.request_id ? 'Responding…' : 'Accept'}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        type="button"
                        disabled={!!requestBusyId}
                        onClick={() => void respondToRequest(request, false)}
                      >
                        <X size={16} />
                        {requestBusyId === request.request_id ? 'Responding…' : 'Decline'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

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

          {error && <p className="alert alert-error" role="alert">{error}</p>}
          <p className="muted" aria-live="polite">
            {loading ? 'Searching members…' : `${discoverProfiles.length} ${discoverProfiles.length === 1 ? 'member' : 'members'} found`}
          </p>
          {!loading && discoverProfiles.length === 0 && (
            <div className="card">
              <h2>No other members found</h2>
              <p className="muted">
                {search.trim()
                  ? `No members match “${search.trim()}”. Try another name, skill, or community.`
                  : 'There are no other member profiles matching these filters yet.'}
              </p>
            </div>
          )}
          {loading && discoverProfiles.length === 0 && <p className="muted">Loading member profiles…</p>}

          <div className="people-grid">
            {!loading && discoverProfiles.map((profile) => {
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
                  <div className="person-card-actions">
                    {profile.network_status === 'none' && (
                      <button
                        className="btn btn-secondary btn-sm"
                        type="button"
                        disabled={!!requestBusyId}
                        onClick={() => void addToNetwork(profile.profile_id)}
                      >
                        <UserPlus size={16} />
                        {requestBusyId === profile.profile_id ? 'Sending…' : 'Add to network'}
                      </button>
                    )}
                    {profile.network_status === 'request_sent' && (
                      <button className="btn btn-secondary btn-sm" type="button" disabled>
                        Request sent
                      </button>
                    )}
                    {profile.network_status === 'connected' && (
                      <button className="btn btn-secondary btn-sm" type="button" disabled>
                        In your network
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

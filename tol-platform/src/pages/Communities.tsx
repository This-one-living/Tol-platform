import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Search, Tag, UsersRound } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { recordAccountActivity } from '../lib/activity'
import './Communities.css'

type CommunityGroup = {
  group_id: string
  group_type: 'niche' | 'lga'
  group_value: string
  member_count: number
  is_member: boolean
}

type PageStatus = 'loading' | 'ready' | 'signed-out' | 'unconfigured' | 'error'
type GroupFilter = 'all' | 'niche' | 'lga' | 'joined'

export default function Communities() {
  const [status, setStatus] = useState<PageStatus>(supabase ? 'loading' : 'unconfigured')
  const [groups, setGroups] = useState<CommunityGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<GroupFilter>('all')
  const [busyGroupId, setBusyGroupId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    let active = true
    const client = supabase

    const loadGroups = async () => {
      try {
        const { data: userData, error: authError } = await client.auth.getUser()
        if (!active) return
        if (authError) {
          setError(authError.message)
          setStatus('error')
          setLoading(false)
          return
        }
        if (!userData.user) {
          setStatus('signed-out')
          setLoading(false)
          return
        }

        const { data, error: groupError } = await client.rpc('get_builtin_groups', {
          search_text: '',
          group_type_filter: null,
        })
        if (!active) return
        if (groupError) {
          setError(groupError.message)
          setStatus('error')
          setLoading(false)
          return
        }

        setGroups((data ?? []) as CommunityGroup[])
        setStatus('ready')
        setLoading(false)
      } catch (loadError) {
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : 'Could not load communities.')
        setStatus('error')
        setLoading(false)
      }
    }

    void loadGroups()
    return () => { active = false }
  }, [])

  const visibleGroups = useMemo(() => {
    const term = search.trim().toLowerCase()
    return groups.filter((group) => {
      const matchesText = !term || group.group_value.toLowerCase().includes(term)
      const matchesFilter = filter === 'all'
        || (filter === 'joined' && group.is_member)
        || group.group_type === filter
      return matchesText && matchesFilter
    })
  }, [filter, groups, search])

  const toggleMembership = async (group: CommunityGroup) => {
    if (!supabase || busyGroupId) return
    const client = supabase
    setError('')
    setBusyGroupId(group.group_id)
    try {
      const { error: membershipError } = await client.rpc(
        group.is_member ? 'leave_builtin_group' : 'join_builtin_group',
        { target_group_id: group.group_id },
      )
      if (membershipError) {
        setError(membershipError.message)
        return
      }
      setGroups((current) => current.map((item) => item.group_id === group.group_id
        ? {
            ...item,
            is_member: !item.is_member,
            member_count: Math.max(0, item.member_count + (item.is_member ? -1 : 1)),
          }
        : item,
      ))
      const activityError = await recordAccountActivity(
        group.is_member ? 'left_group' : 'joined_group',
        group.group_id,
      )
      if (activityError) setError(`Group updated, but activity could not be recorded: ${activityError}`)
    } catch (membershipError) {
      setError(membershipError instanceof Error ? membershipError.message : 'Could not update group membership.')
    } finally {
      setBusyGroupId('')
    }
  }

  if (status === 'loading') {
    return <div className="communities-state"><p>Loading communities…</p></div>
  }

  if (status === 'unconfigured') {
    return (
      <div className="communities-state card">
        <UsersRound size={32} />
        <h1>Communities need a connection</h1>
        <p>Connect this app to Supabase and apply the built-in groups migration to enable groups.</p>
      </div>
    )
  }

  if (status === 'signed-out') {
    return (
      <div className="communities-state card">
        <UsersRound size={32} />
        <h1>Sign in to join communities</h1>
        <p>Log in to browse niche and LGA groups and manage your memberships.</p>
        <Link className="btn btn-primary" to="/auth">Log in</Link>
      </div>
    )
  }

  if (status === 'error') {
    return <p className="alert alert-error" role="alert">{error || 'Could not load communities.'}</p>
  }

  return (
    <section className="communities-page">
      <header className="communities-heading">
        <div>
          <p className="communities-eyebrow">Find your people</p>
          <h1>Communities</h1>
          <p className="muted">Join groups built around your niche or local government area.</p>
        </div>
      </header>

      <div className="community-filters">
        <label className="community-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search niche or LGA groups"
            aria-label="Search groups"
          />
        </label>
        <label className="community-filter">
          <span className="visually-hidden">Filter groups</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value as GroupFilter)}>
            <option value="all">All groups</option>
            <option value="niche">Niche groups</option>
            <option value="lga">LGA groups</option>
            <option value="joined">Your groups</option>
          </select>
        </label>
      </div>

      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <p className="muted" aria-live="polite">
        {loading ? 'Loading groups…' : `${visibleGroups.length} ${visibleGroups.length === 1 ? 'group' : 'groups'}`}
      </p>

      {!loading && visibleGroups.length === 0 && (
        <div className="card communities-empty">
          <h2>No groups found</h2>
          <p className="muted">
            {filter === 'joined' && !search.trim()
              ? 'You have not joined any groups yet.'
              : `No groups match “${search.trim()}” and the selected filter.`}
          </p>
        </div>
      )}

      <div className="community-grid">
        {visibleGroups.map((group) => {
          const isNiche = group.group_type === 'niche'
          const Icon = isNiche ? Tag : MapPin
          return (
            <article className="community-card card" key={group.group_id}>
              <div className="community-card-top">
                <span className="community-icon"><Icon size={20} /></span>
                <span className="community-kind">{isNiche ? 'Niche group' : 'LGA group'}</span>
              </div>
              <h2>{group.group_value}</h2>
              <p className="community-description">
                {isNiche
                  ? `Connect with members in ${group.group_value}.`
                  : `Meet members across ${group.group_value} LGA.`}
              </p>
              <p className="community-members">
                <UsersRound size={16} aria-hidden="true" />
                {group.member_count} {group.member_count === 1 ? 'member' : 'members'}
              </p>
              <button
                className={group.is_member ? 'btn btn-secondary btn-block' : 'btn btn-primary btn-block'}
                type="button"
                disabled={!!busyGroupId}
                onClick={() => void toggleMembership(group)}
              >
                {busyGroupId === group.group_id
                  ? 'Updating…'
                  : group.is_member ? 'Leave group' : 'Join group'}
              </button>
            </article>
          )
        })}
      </div>
    </section>
  )
}

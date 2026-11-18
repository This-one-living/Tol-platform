import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Check, Clock3, Coins, Sparkles, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import './TokenCoin.css'

const ACTIVITY_TYPES = [
  { value: 'message', label: 'Meaningful messages', description: 'Describe a constructive conversation with a TOL member.' },
  { value: 'useful_post', label: 'Useful post', description: 'Share a useful post or learning resource with the community.' },
  { value: 'constructive_comment', label: 'Constructive comment', description: 'Add a helpful, respectful comment to a conversation.' },
  { value: 'appropriate_share', label: 'Appropriate sharing', description: 'Share relevant information that benefits the community.' },
  { value: 'learning_task', label: 'Approved learning task', description: 'Describe an approved learning task you completed.' },
  { value: 'community_support', label: 'Community support', description: 'Explain how you supported another member or group.' },
  { value: 'useful_activity', label: 'Useful community activity', description: 'Describe another useful activity that contributed to TOL.' },
] as const

type ActivityType = typeof ACTIVITY_TYPES[number]['value']

type TokenSummary = {
  balance: number
  earned_today: number
  approved_activities: number
  required_activities: number
  daily_reward: number
  naira_per_token: number
  redemption_status: string
}

type TokenLedgerEntry = {
  id: string
  entry_type: 'earn' | 'adjustment' | 'reversal'
  amount: number
  reason: string | null
  created_at: string
}

type ActivitySubmission = {
  id: string
  activity_date: string
  activity_type: ActivityType
  details: string
  status: 'pending' | 'approved' | 'rejected'
  admin_note: string | null
  submitted_at: string
}

type AdminActivity = ActivitySubmission & {
  user_id: string
  full_name: string
}

type PageStatus = 'loading' | 'ready' | 'signed-out' | 'unconfigured' | 'error'

const formatTokens = (amount: number) =>
  new Intl.NumberFormat('en-NG', { maximumFractionDigits: 4 }).format(Number(amount) || 0)

const formatDate = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })
}

const entryTitle = (entry: TokenLedgerEntry) => {
  if (entry.reason) return entry.reason
  if (entry.entry_type === 'earn') return 'Earlier qualifying message activity'
  if (entry.entry_type === 'reversal') return 'Ledger correction'
  return 'Account adjustment'
}

export default function TokenCoin() {
  const [status, setStatus] = useState<PageStatus>(supabase ? 'loading' : 'unconfigured')
  const [userId, setUserId] = useState('')
  const [summary, setSummary] = useState<TokenSummary | null>(null)
  const [entries, setEntries] = useState<TokenLedgerEntry[]>([])
  const [activities, setActivities] = useState<ActivitySubmission[]>([])
  const [adminActivities, setAdminActivities] = useState<AdminActivity[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [activityType, setActivityType] = useState<ActivityType>('message')
  const [activityDetails, setActivityDetails] = useState('')
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [reviewingId, setReviewingId] = useState('')
  const [error, setError] = useState('')
  const [activityError, setActivityError] = useState('')

  const loadTokenData = useCallback(async (accountId: string) => {
    if (!supabase) return
    const client = supabase
    setError('')
    const [summaryResult, ledgerResult, activitiesResult, adminResult] = await Promise.all([
      client.rpc('my_token_summary'),
      client.from('token_ledger')
        .select('id, entry_type, amount, reason, created_at')
        .eq('user_id', accountId)
        .order('created_at', { ascending: false })
        .limit(30),
      client.rpc('my_token_activities'),
      client.rpc('is_admin'),
    ])
    if (summaryResult.error) {
      setError(summaryResult.error.message)
      setStatus('error')
      return
    }
    if (activitiesResult.error) {
      setError(activitiesResult.error.message)
      setStatus('error')
      return
    }
    if (adminResult.error) {
      setError(adminResult.error.message)
      setStatus('error')
      return
    }

    const summaryRow = (summaryResult.data?.[0] ?? null) as TokenSummary | null
    if (!summaryRow) {
      setError('Your TOL Coin summary could not be found. Complete your profile and try again.')
      setStatus('error')
      return
    }
    setSummary(summaryRow)
    const activityRows = (activitiesResult.data ?? []) as ActivitySubmission[]
    setActivities(activityRows)
    const nextActivity = ACTIVITY_TYPES.find((activity) =>
      !activityRows.some((submission) =>
        submission.activity_type === activity.value && submission.status !== 'rejected',
      ),
    )
    if (nextActivity) setActivityType(nextActivity.value)
    setIsAdmin(adminResult.data === true)
    setActivityError(ledgerResult.error?.message ?? '')
    setEntries(ledgerResult.error ? [] : (ledgerResult.data ?? []) as TokenLedgerEntry[])

    if (adminResult.data === true) {
      const { data, error: adminActivitiesError } = await client.rpc('admin_list_tol_activities', {
        p_status: 'pending',
      })
      if (adminActivitiesError) {
        setError(adminActivitiesError.message)
        setStatus('error')
        return
      }
      setAdminActivities((data ?? []) as AdminActivity[])
    } else {
      setAdminActivities([])
    }
    setStatus('ready')
  }, [])

  useEffect(() => {
    if (!supabase) return
    let active = true
    const client = supabase
    const initialize = async () => {
      const { data, error: authError } = await client.auth.getUser()
      if (!active) return
      if (authError) {
        setError(authError.message)
        setStatus('error')
      } else if (!data.user) {
        setStatus('signed-out')
      } else {
        setUserId(data.user.id)
        await loadTokenData(data.user.id)
      }
    }
    void initialize().catch((loadError: unknown) => {
      if (!active) return
      setError(loadError instanceof Error ? loadError.message : 'Could not load your TOL Coin account.')
      setStatus('error')
    })
    return () => { active = false }
  }, [loadTokenData])

  const submitActivity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || submitting || !userId) return
    setSubmitting(true)
    setError('')
    try {
      const { error: submitError } = await supabase.rpc('submit_tol_activity', {
        p_activity_type: activityType,
        p_details: activityDetails,
      })
      if (submitError) {
        setError(submitError.message)
        return
      }
      setActivityDetails('')
      await loadTokenData(userId)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not submit your activity.')
    } finally {
      setSubmitting(false)
    }
  }

  const reviewActivity = async (activity: AdminActivity, decision: 'approved' | 'rejected') => {
    if (!supabase || reviewingId) return
    const note = adminNotes[activity.id]?.trim() ?? ''
    if (decision === 'rejected' && !note) {
      setError('Add a reason before rejecting an activity.')
      return
    }
    setReviewingId(activity.id)
    setError('')
    try {
      const { error: reviewError } = await supabase.rpc('admin_review_tol_activity', {
        p_submission: activity.id,
        p_decision: decision,
        p_note: note || null,
      })
      if (reviewError) {
        setError(reviewError.message)
        return
      }
      await loadTokenData(userId)
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Could not review this activity.')
    } finally {
      setReviewingId('')
    }
  }

  if (status === 'loading') {
    return <div className="token-state" role="status">Loading your TOL Coin account…</div>
  }

  if (status === 'unconfigured') {
    return (
      <div className="token-state card">
        <Coins size={32} />
        <h1>TOL Coin is unavailable</h1>
        <p>Connect this app to Supabase and apply the TOL Coin migration to view your account.</p>
      </div>
    )
  }

  if (status === 'signed-out') {
    return (
      <div className="token-state card">
        <Coins size={32} />
        <h1>Sign in to view TOL Coin</h1>
        <p>Your balance and activity are available after you sign in.</p>
        <Link className="btn btn-primary" to="/auth">Log in</Link>
      </div>
    )
  }

  if (status === 'error' || !summary) {
    return <p className="alert alert-error" role="alert">{error || 'Could not load TOL Coin.'}</p>
  }

  const referenceValue = Number(summary.balance) * Number(summary.naira_per_token)
  const redemptionAvailable = summary.redemption_status === 'available'
  const selectedActivity = ACTIVITY_TYPES.find((item) => item.value === activityType)
  const currentActivity = activities.find((item) =>
    item.activity_type === activityType && item.status !== 'rejected',
  )

  return (
    <section className="token-page">
      <header className="token-heading">
        <div>
          <p className="token-eyebrow">YOUR COMMUNITY REWARDS</p>
          <h1>TOL Coin</h1>
          <p className="muted">A transparent record of the TOL Coins you earn by contributing to the community.</p>
        </div>
        <span className="token-heading-icon"><Coins size={24} /></span>
      </header>

      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <section className="token-balance-panel" aria-label="TOL Coin balance">
        <div className="token-balance-copy">
          <p className="token-balance-label">AVAILABLE BALANCE</p>
          <p className="token-balance-value">{formatTokens(Number(summary.balance))} <span>TOL</span></p>
          <p className="token-balance-note">
            Reference value: ₦{formatTokens(referenceValue)}. TOL Coins are not cash and cannot currently be redeemed.
          </p>
        </div>
        <div className="token-balance-mark" aria-hidden="true"><Coins size={52} /></div>
      </section>

      <div className="token-stat-grid">
        <article className="token-stat card">
          <span className="token-stat-icon"><Coins size={19} /></span>
          <p className="token-stat-label">Daily activity reward</p>
          <strong>{formatTokens(Number(summary.earned_today))} <span>TOL</span></strong>
          <small>{formatTokens(Number(summary.daily_reward))} TOL Coin after all activities are approved</small>
        </article>
        <article className="token-stat card">
          <span className="token-stat-icon"><Clock3 size={19} /></span>
          <p className="token-stat-label">Activities approved today</p>
          <strong>{summary.approved_activities}/{summary.required_activities}</strong>
          <small>Admin approval is required for every activity</small>
        </article>
        <article className="token-stat card">
          <span className="token-stat-icon"><Sparkles size={19} /></span>
          <p className="token-stat-label">Redemption</p>
          <strong>{redemptionAvailable ? 'Available' : 'Coming soon'}</strong>
          <small>TOL Coins are not currently cash</small>
        </article>
      </div>

      <section className="token-tasks card" aria-labelledby="token-tasks-title">
        <div className="token-section-heading">
          <div>
            <h2 id="token-tasks-title">Today’s activities</h2>
            <p className="muted">Submit each completed activity for admin approval. One TOL Coin is earned after all seven are approved today.</p>
          </div>
        </div>
        <ul className="token-task-list">
          {ACTIVITY_TYPES.map((activity) => {
            const submission = activities.find((item) => item.activity_type === activity.value)
            return (
              <li className="token-task" key={activity.value}>
                <span className={`token-task-status token-task-${submission?.status ?? 'not-submitted'}`}>
                  {submission?.status === 'approved'
                    ? <Check size={16} aria-label="Approved" />
                    : submission?.status === 'rejected'
                      ? <X size={16} aria-label="Rejected" />
                      : submission?.status === 'pending'
                        ? <Clock3 size={16} aria-label="Pending review" />
                        : <span aria-hidden="true" />}
                </span>
                <span className="token-task-copy">
                  <strong>{activity.label}</strong>
                  <small>{submission?.status === 'rejected'
                    ? `Not approved${submission.admin_note ? `: ${submission.admin_note}` : ''}`
                    : submission?.status === 'approved'
                      ? 'Approved'
                      : submission?.status === 'pending'
                        ? 'Waiting for admin approval'
                        : activity.description}</small>
                </span>
              </li>
            )
          })}
        </ul>

        <form className="token-task-form" onSubmit={submitActivity}>
          <label>
            Activity to submit
            <select
              value={activityType}
              onChange={(event) => setActivityType(event.target.value as ActivityType)}
            >
              {ACTIVITY_TYPES.map((activity) => {
                const submission = activities.find((item) => item.activity_type === activity.value && item.status !== 'rejected')
                return (
                  <option key={activity.value} value={activity.value} disabled={Boolean(submission)}>
                    {activity.label}{submission ? ` — ${submission.status}` : ''}
                  </option>
                )
              })}
            </select>
          </label>
          <label>
            Describe what you completed
            <textarea
              value={activityDetails}
              onChange={(event) => setActivityDetails(event.target.value)}
              placeholder={selectedActivity?.description ?? 'Describe your activity.'}
              minLength={10}
              maxLength={1000}
              required
            />
          </label>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={submitting || Boolean(currentActivity) || activityDetails.trim().length < 10}
          >
            {submitting ? 'Submitting…' : currentActivity ? 'Submitted for today' : 'Submit for approval'}
          </button>
        </form>
      </section>

      {isAdmin && (
        <section className="token-admin card" aria-labelledby="token-admin-title">
          <div className="token-section-heading">
            <div>
              <h2 id="token-admin-title">Activity approval queue</h2>
              <p className="muted">{adminActivities.length} pending submission{adminActivities.length === 1 ? '' : 's'}</p>
            </div>
          </div>
          {adminActivities.length === 0
            ? <p className="token-empty">There are no activities waiting for approval.</p>
            : (
              <ul className="token-admin-list">
                {adminActivities.map((activity) => (
                  <li className="token-admin-item" key={activity.id}>
                    <div className="token-admin-copy">
                      <strong>{activity.full_name} · {ACTIVITY_TYPES.find((item) => item.value === activity.activity_type)?.label ?? activity.activity_type}</strong>
                      <small>{activity.activity_date} · submitted {formatDate(activity.submitted_at)}</small>
                      <p>{activity.details}</p>
                      <label>
                        <span className="visually-hidden">Review note for {activity.full_name}</span>
                        <input
                          value={adminNotes[activity.id] ?? ''}
                          onChange={(event) => setAdminNotes((current) => ({ ...current, [activity.id]: event.target.value }))}
                          placeholder="Optional approval note; required to reject"
                          maxLength={500}
                        />
                      </label>
                    </div>
                    <div className="token-admin-actions">
                      <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        disabled={Boolean(reviewingId)}
                        onClick={() => void reviewActivity(activity, 'approved')}
                      >
                        Approve
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        type="button"
                        disabled={Boolean(reviewingId) || !(adminNotes[activity.id] ?? '').trim()}
                        onClick={() => void reviewActivity(activity, 'rejected')}
                      >
                        Reject
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </section>
      )}

      <section className="token-activity card" aria-labelledby="token-activity-title">
        <div className="token-section-heading">
          <div>
            <h2 id="token-activity-title">Recent activity</h2>
            <p className="muted">Your latest TOL Coin ledger entries.</p>
          </div>
        </div>
        {activityError && <p className="alert alert-error" role="alert">{activityError}</p>}
        {!activityError && entries.length === 0 && (
          <p className="token-empty">No TOL Coin entries yet. Complete and submit today’s activities for approval.</p>
        )}
        {!activityError && entries.length > 0 && (
          <ul className="token-entry-list">
            {entries.map((entry) => {
              const isPositive = Number(entry.amount) >= 0
              const AmountIcon = isPositive ? ArrowDownLeft : ArrowUpRight
              return (
                <li className="token-entry" key={entry.id}>
                  <span className={`token-entry-icon${isPositive ? ' token-entry-positive' : ' token-entry-negative'}`}>
                    <AmountIcon size={18} />
                  </span>
                  <span className="token-entry-copy">
                    <strong>{entryTitle(entry)}</strong>
                    <small>{formatDate(entry.created_at)}</small>
                  </span>
                  <strong className={`token-entry-amount${isPositive ? ' token-entry-positive-text' : ' token-entry-negative-text'}`}>
                    {isPositive ? '+' : ''}{formatTokens(Number(entry.amount))} <span>TOL</span>
                  </strong>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <aside className="token-how-it-works">
        <span className="token-how-icon"><Sparkles size={20} /></span>
        <div>
          <h2>How TOL Coins are earned</h2>
          <p>
            Complete all seven activities in one day: meaningful messages, a useful post, a constructive comment,
            appropriate sharing, an approved learning task, community support, and another useful community activity.
            An admin must approve each submission. Once all are approved, one TOL Coin is credited for that Lagos-local day.
          </p>
        </div>
      </aside>
    </section>
  )
}

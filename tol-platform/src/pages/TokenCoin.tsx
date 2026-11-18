import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Coins, Clock3, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'
import './TokenCoin.css'

type TokenSummary = {
  balance: number
  earned_today_minutes: number
  per_minute: number
  naira_per_token: number
  daily_cap_minutes: number
  redemption_status: string
}

type TokenLedgerEntry = {
  id: string
  entry_type: 'earn' | 'adjustment' | 'reversal'
  amount: number
  reason: string | null
  created_at: string
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
  if (entry.entry_type === 'earn') return 'Qualifying one-to-one message minute'
  if (entry.entry_type === 'reversal') return 'Ledger correction'
  return 'Account adjustment'
}

export default function TokenCoin() {
  const [status, setStatus] = useState<PageStatus>(supabase ? 'loading' : 'unconfigured')
  const [summary, setSummary] = useState<TokenSummary | null>(null)
  const [entries, setEntries] = useState<TokenLedgerEntry[]>([])
  const [error, setError] = useState('')
  const [activityError, setActivityError] = useState('')

  useEffect(() => {
    if (!supabase) return
    let active = true
    const client = supabase

    const loadTokenData = async () => {
      try {
        const { data: userData, error: authError } = await client.auth.getUser()
        if (!active) return
        if (authError) {
          setError(authError.message)
          setStatus('error')
          return
        }
        if (!userData.user) {
          setStatus('signed-out')
          return
        }

        const [summaryResult, ledgerResult] = await Promise.all([
          client.rpc('my_token_summary'),
          client.from('token_ledger')
            .select('id, entry_type, amount, reason, created_at')
            .eq('user_id', userData.user.id)
            .order('created_at', { ascending: false })
            .limit(30),
        ])
        if (!active) return
        if (summaryResult.error) {
          setError(summaryResult.error.message)
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
        if (ledgerResult.error) {
          setActivityError(ledgerResult.error.message)
        } else {
          setEntries((ledgerResult.data ?? []) as TokenLedgerEntry[])
        }
        setStatus('ready')
      } catch (loadError) {
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : 'Could not load your TOL Coin account.')
        setStatus('error')
      }
    }

    void loadTokenData()
    return () => { active = false }
  }, [])

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
  const maxDailyCoins = Number(summary.daily_cap_minutes) * Number(summary.per_minute)

  return (
    <section className="token-page">
      <header className="token-heading">
        <div>
          <p className="token-eyebrow">YOUR COMMUNITY REWARDS</p>
          <h1>TOL Coin</h1>
          <p className="muted">Earn TOL Coins through qualifying one-to-one conversations.</p>
        </div>
        <span className="token-heading-icon"><Coins size={24} /></span>
      </header>

      <section className="token-balance-panel" aria-label="TOL Coin balance">
        <div className="token-balance-copy">
          <p className="token-balance-label">AVAILABLE BALANCE</p>
          <p className="token-balance-value">{formatTokens(Number(summary.balance))} <span>TOL</span></p>
          <p className="token-balance-note">
            Reference value: ₦{formatTokens(referenceValue)} (₦{formatTokens(Number(summary.naira_per_token))} per coin).
            Redemption is coming soon.
          </p>
        </div>
        <div className="token-balance-mark" aria-hidden="true"><Coins size={52} /></div>
      </section>

      <div className="token-stat-grid">
        <article className="token-stat card">
          <span className="token-stat-icon"><Clock3 size={19} /></span>
          <p className="token-stat-label">Qualifying minutes today</p>
          <strong>{formatTokens(Number(summary.earned_today_minutes))}/{formatTokens(Number(summary.daily_cap_minutes))}</strong>
          <small>At least one text message in each minute</small>
        </article>
        <article className="token-stat card">
          <span className="token-stat-icon"><Sparkles size={19} /></span>
          <p className="token-stat-label">Earning rate</p>
          <strong>{formatTokens(Number(summary.per_minute))} <span>TOL</span></strong>
          <small>₦0.40 per minute; up to {formatTokens(maxDailyCoins)} TOL Coins per day</small>
        </article>
        <article className="token-stat card">
          <span className="token-stat-icon"><Coins size={19} /></span>
          <p className="token-stat-label">Redemption</p>
          <strong>{redemptionAvailable ? 'Available' : 'Coming soon'}</strong>
          <small>1 TOL Coin = ₦{formatTokens(Number(summary.naira_per_token))} reference value</small>
        </article>
      </div>

      <section className="token-activity card" aria-labelledby="token-activity-title">
        <div className="token-section-heading">
          <div>
            <h2 id="token-activity-title">Recent activity</h2>
            <p className="muted">Your latest TOL Coin ledger entries.</p>
          </div>
        </div>
        {activityError && <p className="alert alert-error" role="alert">{activityError}</p>}
        {!activityError && entries.length === 0 && (
          <p className="token-empty">No activity yet. Send a text message in a qualifying one-to-one chat to earn TOL Coins.</p>
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
            A qualifying minute needs at least one text message sent in a one-to-one chat with an accepted connection.
            You earn 0.1 TOL Coin once per qualifying minute, up to 1,440 minutes (144 TOL Coins) per Lagos-local day.
            One TOL Coin has a reference value of ₦4. Checkout and redemption are coming soon.
          </p>
        </div>
      </aside>
    </section>
  )
}

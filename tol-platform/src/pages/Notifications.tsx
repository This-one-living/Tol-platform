import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Bell,
  Heart,
  MessageCircle,
  MessageSquare,
  Users,
  UsersRound,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { disableBrowserPush, enableBrowserPush, isBrowserPushEnabledForUser } from '../lib/push'
import './Notifications.css'

type NotificationItem = {
  id: string
  type: string
  title: string
  body: string | null
  data: Record<string, unknown>
  read_at: string | null
  created_at: string
}

type PageStatus = 'loading' | 'ready' | 'signed-out' | 'unconfigured' | 'error'

const formatDate = (value: string) =>
  new Date(value).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })

const iconFor = (type: string) => {
  switch (type) {
    case 'message': return MessageCircle
    case 'network_request':
    case 'network_accepted':
    case 'network_declined': return Users
    case 'post_comment': return MessageSquare
    case 'post_like': return Heart
    case 'community_activity': return UsersRound
    default: return Bell
  }
}

export default function Notifications() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<PageStatus>(supabase ? 'loading' : 'unconfigured')
  const [userId, setUserId] = useState('')
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [error, setError] = useState('')
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase) return
    let active = true
    const client = supabase
    let channel: ReturnType<typeof client.channel> | null = null

    const loadNotifications = async (accountId: string) => {
      const { data, error: loadError } = await client
        .from('notifications')
        .select('id, type, title, body, data, read_at, created_at')
        .eq('user_id', accountId)
        .order('created_at', { ascending: false })
        .limit(50)
      if (!active) return
      if (loadError) {
        setError(loadError.message)
        setStatus('error')
        return
      }
      setNotifications((data ?? []) as NotificationItem[])
      setStatus('ready')
    }

    const initialize = async () => {
      const { data, error: authError } = await client.auth.getUser()
      if (!active) return
      if (authError) {
        setError(authError.message)
        setStatus('error')
        return
      }
      if (!data.user) {
        setStatus('signed-out')
        return
      }

      const accountId = data.user.id
      setUserId(accountId)
      await loadNotifications(accountId)
      if (!active) return

      channel = client
        .channel(`notifications:${accountId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${accountId}`,
        }, () => { void loadNotifications(accountId) })
        .subscribe()

      const enabled = await isBrowserPushEnabledForUser(accountId)
      if (active) setPushEnabled(enabled)
    }

    void initialize()
      .catch((loadError: unknown) => {
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : 'Could not load notifications.')
        setStatus('error')
      })

    return () => {
      active = false
      if (channel) void client.removeChannel(channel)
    }
  }, [])

  const markAllRead = async () => {
    if (!supabase || busy || !userId) return
    setBusy(true)
    setError('')
    const { error: updateError } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null)
    if (updateError) setError(updateError.message)
    else {
      const readAt = new Date().toISOString()
      setNotifications((current) => current.map((item) => item.read_at ? item : { ...item, read_at: readAt }))
    }
    setBusy(false)
  }

  const openNotification = async (item: NotificationItem) => {
    if (!supabase || busy) return
    setBusy(true)
    if (!item.read_at) {
      const { error: updateError } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', item.id)
      if (updateError) {
        setError(updateError.message)
        setBusy(false)
        return
      }
      setNotifications((current) => current.map((notification) => notification.id === item.id
        ? { ...notification, read_at: new Date().toISOString() }
        : notification,
      ))
    }
    setBusy(false)
    const fallbackPath = item.type === 'message' && typeof item.data.from === 'string'
      ? `/messages?with=${encodeURIComponent(item.data.from)}`
      : item.type.startsWith('network_')
        ? '/connections'
        : '/home'
    const path = typeof item.data.path === 'string' && item.data.path.startsWith('/') && !item.data.path.startsWith('//')
      ? item.data.path
      : fallbackPath
    navigate(path)
  }

  const togglePush = async () => {
    if (!userId || pushBusy) return
    setPushBusy(true)
    setError('')
    try {
      if (pushEnabled) {
        await disableBrowserPush(userId)
        setPushEnabled(false)
      } else {
        await enableBrowserPush()
        setPushEnabled(true)
      }
    } catch (pushError) {
      setError(pushError instanceof Error ? pushError.message : 'Could not update browser push settings.')
    } finally {
      setPushBusy(false)
    }
  }

  if (status === 'loading') return <div className="notification-state" role="status">Loading notifications…</div>

  if (status === 'unconfigured') {
    return (
      <div className="notification-state card">
        <h1>Notifications are unavailable</h1>
        <p>Connect this app to Supabase and apply the notifications migration to enable notifications.</p>
      </div>
    )
  }

  if (status === 'signed-out') {
    return (
      <div className="notification-state card">
        <h1>Sign in to view notifications</h1>
        <p>Sign in to keep up with messages, network requests, and community activity.</p>
        <Link className="btn btn-primary" to="/auth">Log in</Link>
      </div>
    )
  }

  if (status === 'error' && notifications.length === 0) {
    return <p className="alert alert-error" role="alert">{error || 'Could not load notifications.'}</p>
  }

  const unreadCount = notifications.filter((item) => !item.read_at).length

  return (
    <section className="notifications-page">
      <header className="notifications-heading">
        <div>
          <p className="notifications-eyebrow">Stay up to date</p>
          <h1>Notifications</h1>
          <p className="muted">{unreadCount ? `${unreadCount} unread` : 'You’re all caught up.'}</p>
        </div>
        <div className="notifications-controls">
          <button className="btn btn-secondary" type="button" onClick={() => void togglePush()} disabled={pushBusy}>
            {pushBusy ? 'Updating…' : pushEnabled ? 'Turn off browser push' : 'Enable browser push'}
          </button>
          {unreadCount > 0 && (
            <button className="btn btn-primary" type="button" onClick={() => void markAllRead()} disabled={busy}>
              Mark all as read
            </button>
          )}
        </div>
      </header>

      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <div className="notification-list" aria-live="polite">
        {notifications.length === 0 && (
          <div className="card notification-empty">
            <Bell size={28} aria-hidden="true" />
            <h2>No notifications yet</h2>
            <p className="muted">New messages, network requests, post activity, and community updates will appear here.</p>
          </div>
        )}
        {notifications.map((item) => {
          const Icon = iconFor(item.type)
          return (
            <button
              className={`notification-item card${item.read_at ? '' : ' is-unread'}`}
              key={item.id}
              type="button"
              onClick={() => void openNotification(item)}
              disabled={busy}
            >
              <span className="notification-icon"><Icon size={19} aria-hidden="true" /></span>
              <span className="notification-content">
                <strong>{item.title}</strong>
                {item.body && <span>{item.body}</span>}
                <time dateTime={item.created_at}>{formatDate(item.created_at)}</time>
              </span>
              {!item.read_at && <span className="notification-unread-dot" aria-label="Unread" />}
            </button>
          )
        })}
      </div>
    </section>
  )
}

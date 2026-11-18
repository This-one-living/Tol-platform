import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  Home,
  Compass,
  Users,
  Bell,
  MessageSquare,
  UsersRound,
  Coins,
  Settings,
} from 'lucide-react'
import { supabase } from '../lib/supabase'

const links = [
  { to: '/home', label: 'Home', icon: Home, end: true },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/connections', label: 'Connections', icon: Users },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/messages', label: 'Messages', icon: MessageSquare },
  { to: '/communities', label: 'Communities', icon: UsersRound },
  { to: '/token-coin', label: 'TOL Coin', icon: Coins },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export default function Layout() {
  const [unreadCount, setUnreadCount] = useState(0)
  const [notificationCountError, setNotificationCountError] = useState(false)

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    let active = true
    let currentUserId = ''
    let channel: ReturnType<typeof client.channel> | null = null

    const refreshCount = async (accountId: string) => {
      const { count, error } = await client
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', accountId)
        .is('read_at', null)
      if (!active || currentUserId !== accountId) return
      if (error) {
        setNotificationCountError(true)
        return
      }
      setNotificationCountError(false)
      setUnreadCount(count ?? 0)
    }

    const watchUser = (accountId: string) => {
      if (currentUserId === accountId) return
      currentUserId = accountId
      if (channel) void client.removeChannel(channel)
      channel = null
      setUnreadCount(0)
      if (!accountId) return
      void refreshCount(accountId)
      channel = client
        .channel(`notification-count:${accountId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${accountId}`,
        }, () => { void refreshCount(accountId) })
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setNotificationCountError(true)
          }
        })
    }

    const { data: authListener } = client.auth.onAuthStateChange((_event, session) => {
      watchUser(session?.user.id ?? '')
    })
    void client.auth.getUser().then(({ data, error }) => {
      if (error) setNotificationCountError(true)
      else watchUser(data.user?.id ?? '')
    })

    return () => {
      active = false
      authListener.subscription.unsubscribe()
      if (channel) void client.removeChannel(channel)
    }
  }, [])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/home" className="brand">
          This One Living
        </NavLink>
        <nav className="nav">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              <Icon />
              {label}
              {to === '/notifications' && (unreadCount > 0 || notificationCountError) && (
                <span className="nav-badge" aria-label={notificationCountError ? 'Unread notifications unavailable' : `${unreadCount} unread notifications`}>
                  {notificationCountError ? '!' : unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}

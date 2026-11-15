import { NavLink, Outlet } from 'react-router-dom'
import {
  Home,
  Compass,
  Users,
  MessageSquare,
  UsersRound,
  Coins,
  Settings,
} from 'lucide-react'

const links = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/connections', label: 'Connections', icon: Users },
  { to: '/messages', label: 'Messages', icon: MessageSquare },
  { to: '/communities', label: 'Communities', icon: UsersRound },
  { to: '/token-coin', label: 'Token Coin', icon: Coins },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export default function Layout() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          The One Living
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

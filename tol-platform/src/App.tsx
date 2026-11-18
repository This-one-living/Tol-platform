import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout.tsx'
import Auth from './pages/Auth.tsx'
import Home from './pages/Home.tsx'
import Discover from './pages/Discover.tsx'
import Settings from './pages/Settings.tsx'
import Signup from './pages/Signup.tsx'
import Messages from './pages/Messages.tsx'
import Communities from './pages/Communities.tsx'
import Connections from './pages/Connections.tsx'
import TokenCoin from './pages/TokenCoin.tsx'
import ForgotPassword from './pages/ForgotPassword.tsx'
import ResetPassword from './pages/ResetPassword.tsx'

const isProfileComplete = () => {
  try {
    return localStorage.getItem('tol_profile_complete') === 'true' || localStorage.getItem('tol_session') === 'true'
  } catch {
    return false
  }
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={isProfileComplete() ? <Navigate to="/home" replace /> : <Navigate to="/auth" replace />} />
        <Route path="/auth" element={isProfileComplete() ? <Navigate to="/home" replace /> : <Auth />} />
        <Route path="/login" element={isProfileComplete() ? <Navigate to="/home" replace /> : <Auth />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route element={<Layout />}>
          <Route path="/home" element={<Home />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/connections" element={<Connections />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/communities" element={<Communities />} />
          <Route path="/token-coin" element={<TokenCoin />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        <Route path="/signup" element={<Signup />} />
      </Routes>
    </BrowserRouter>
  )
}
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Auth from './pages/Auth'
import Home from './pages/Home'
import Discover from './pages/Discover'
import Settings from './pages/Settings'
import Signup from './pages/Signup'

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

        <Route element={<Layout />}>
          <Route path="/home" element={<Home />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        <Route path="/signup" element={<Signup />} />
      </Routes>
    </BrowserRouter>
  )
}
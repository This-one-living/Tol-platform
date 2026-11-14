import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Auth from './pages/Auth'
import Home from './pages/Home'
import Discover from './pages/Discover'
import Signup from './pages/Signup'

const isProfileComplete = () => localStorage.getItem('tol_profile_complete') === 'true'

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
        </Route>

        <Route path="/signup" element={<Signup />} />
        <Route path="*" element={<Navigate to="/auth" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
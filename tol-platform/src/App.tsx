import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Discover from './pages/Discover'
import Signup from './pages/Signup'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/discover" element={<Discover />} />
      </Route>
      <Route path="/signup" element={<Signup />} />
    </Routes>
  )
}
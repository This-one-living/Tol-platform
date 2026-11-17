import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import './App.css';
import './styles-additions.css';
import Home from './pages/Home';
import Discover from './pages/Discover';
import Signup from './pages/Signup.tsx';

export default function App() {
  return (
    <BrowserRouter>
      <nav style={{ padding: 16 }}>
        <Link to="/">Home</Link> · <Link to="/discover">Discover</Link> · <Link to="/signup">Sign up</Link>
      </nav>
      <main style={{ padding: 16 }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/signup" element={<Signup />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

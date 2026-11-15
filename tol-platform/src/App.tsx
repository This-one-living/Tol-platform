import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import './App.css';
import './styles-additions.css';
import Home from './pages/Home';
import Signup from './pages/Signup.tsx';

export default function App() {
  return (
    <BrowserRouter>
      <nav style={{ padding: 16 }}><Link to="/">Home</Link> · <Link to="/signup">Sign up</Link></nav>
      <main style={{ padding: 16 }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/signup" element={<Signup />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

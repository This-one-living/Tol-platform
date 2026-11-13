import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import Signup from './pages/Signup.tsx';

export default function App() {
  return (
    <BrowserRouter>
      <nav style={{ padding: 16 }}><Link to="/">Home</Link> · <Link to="/signup">Sign up</Link></nav>
      <main style={{ padding: 16 }}>
        <Routes>
          <Route path="/" element={<h1>This-ONE Living</h1>} />
          <Route path="/signup" element={<Signup />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
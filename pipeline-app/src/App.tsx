import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Dashboard from './pages/Dashboard'
import Analytics from './pages/Analytics'
import Settings from './pages/Settings'
import Profile from './pages/Profile'

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/profile" element={<Profile />} />
      </Route>
    </Routes>
  )
}

export default App
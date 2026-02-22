import { Routes, Route, Navigate } from 'react-router-dom'
import NavBar from './components/NavBar'
import { AuthProvider } from './context/AuthContext'
import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import GolfLogger from './pages/GolfLogger'
import Directions from './pages/Directions'
import Teams from './pages/Teams'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'

export default function App() {
  return (
    <AuthProvider>
      <NavBar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/golf-logger" element={<GolfLogger />} />
        <Route path="/teams" element={<Teams />} />
        <Route path="/directions" element={<Directions />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

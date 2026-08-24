import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from './services/supabase'
import Login from './pages/Login'
import Register from './pages/Register'
import AdminDashboard from './pages/AdminDashboard'
import DoctorDashboard from './pages/DoctorDashboard'
import PatientDashboard from './pages/PatientDashboard'
import OAuthCallback from './pages/OAuthCallback'
import Sidebar from './components/Sidebar'
import Toast from './components/Toast'

export default function App() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [screen, setScreen] = useState('login') // 'login' | 'register' | 'dashboard' | 'oauth_callback'
  const [activeTab, setActiveTab] = useState('')
  const [toasts, setToasts] = useState([])

  // Global toast function
  const addToast = useCallback((message, type = 'success') => {
    const id = Math.random().toString(36).substring(2, 9)
    setToasts((prev) => [...prev, { id, message, type }])
  }, [])

  const dismissToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  // Load and listen to Supabase auth session
  useEffect(() => {
    // Check if we are on the OAuth callback route
    if (window.location.pathname === '/oauth/callback') {
      setScreen('oauth_callback')
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user)
        fetchProfile(session.user.id)
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user)
        fetchProfile(session.user.id)
      } else {
        setUser(null)
        setProfile(null)
        if (window.location.pathname !== '/oauth/callback') {
          setScreen('login')
        }
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const fetchProfile = async (userId) => {
    try {
      let { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()

      if (error) throw error

      // If profile does not exist yet (e.g. user created before schema trigger existed), auto-create it
      if (!data) {
        const { data: userData } = await supabase.auth.getUser()
        const userObj = userData?.user
        const newProfile = {
          id: userId,
          email: userObj?.email || '',
          name: userObj?.user_metadata?.name || userObj?.email?.split('@')[0] || 'User',
          role: userObj?.user_metadata?.role || 'patient'
        }

        const { data: createdProfile, error: createErr } = await supabase
          .from('profiles')
          .upsert(newProfile)
          .select()
          .single()

        if (createErr) throw createErr
        data = createdProfile
      }

      setProfile(data)
      if (window.location.pathname !== '/oauth/callback') {
        setScreen('dashboard')
      }
      
      // Set default tabs based on role
      if (data.role === 'admin') setActiveTab('doctors')
      else if (data.role === 'doctor') setActiveTab('schedule')
      else if (data.role === 'patient') setActiveTab('book')
    } catch (err) {
      console.error("Error fetching user profile:", err.message)
      addToast("Failed to sync profile: " + err.message, "error")
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    setLoading(true)
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    setScreen('login')
    setLoading(false)
    addToast('Logged out successfully', 'success')
  }

  const handleOAuthCallbackComplete = () => {
    // Clear URL parameters
    window.history.replaceState({}, document.title, "/")
    if (user) {
      fetchProfile(user.id)
    } else {
      setScreen('login')
    }
  }

  if (loading) {
    return (
      <div className="auth-wrapper">
        <div style={{ textAlign: 'center' }}>
          <h2>MediCare Connect</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>Loading platform resources...</p>
        </div>
      </div>
    )
  }

  // Render Google OAuth Callback Page
  if (screen === 'oauth_callback') {
    return (
      <>
        <OAuthCallback 
          addToast={addToast} 
          onComplete={handleOAuthCallbackComplete} 
        />
        <Toast toasts={toasts} onDismiss={dismissToast} />
      </>
    )
  }

  // Render Auth screens
  if (!user || !profile || screen === 'login' || screen === 'register') {
    return (
      <>
        {screen === 'register' ? (
          <Register 
            addToast={addToast}
            navigateToLogin={() => setScreen('login')}
          />
        ) : (
          <Login 
            onLoginSuccess={(usr) => {
              setUser(usr)
              fetchProfile(usr.id)
            }}
            addToast={addToast}
            navigateToRegister={() => setScreen('register')}
          />
        )}
        <Toast toasts={toasts} onDismiss={dismissToast} />
      </>
    )
  }

  // Render Dashboard based on role
  return (
    <div className="app-container">
      <Sidebar 
        user={user} 
        profile={profile} 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        onLogout={handleLogout} 
      />

      <main style={{ flex: 1, overflowY: 'auto', height: '100vh' }}>
        {profile?.role === 'admin' && (
          <AdminDashboard 
            addToast={addToast} 
            activeTab={activeTab} 
          />
        )}
        
        {profile?.role === 'doctor' && (
          <DoctorDashboard 
            user={user} 
            addToast={addToast} 
            activeTab={activeTab} 
          />
        )}
        
        {profile?.role === 'patient' && (
          <PatientDashboard 
            user={user} 
            addToast={addToast} 
            activeTab={activeTab} 
          />
        )}
      </main>

      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}

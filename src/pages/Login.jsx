import React, { useState } from 'react'
import { supabase } from '../services/supabase'

export default function Login({ onLoginSuccess, addToast, navigateToRegister }) {
  const [selectedTab, setSelectedTab] = useState('patient') // 'patient' | 'doctor' | 'admin'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  // Quick fill helper for roles
  const handleTabChange = (role) => {
    setSelectedTab(role)
    setEmail('')
    setPassword('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email || !password) {
      addToast('Please fill in all fields', 'warning')
      return
    }

    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (error) throw error

      if (data?.user) {
        // Fetch user's actual role from the database profiles
        const { data: dbProfile, error: pErr } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', data.user.id)
          .maybeSingle()

        if (pErr) throw pErr

        let finalRole = dbProfile?.role

        // If profile does not exist, create it with default role 'patient'
        if (!dbProfile) {
          finalRole = 'patient'
          const { error: insErr } = await supabase.from('profiles').insert({
            id: data.user.id,
            email: data.user.email,
            name: data.user.user_metadata?.name || data.user.email?.split('@')[0] || 'User',
            role: 'patient'
          })
          if (insErr) throw insErr
        }

        // Verify if actual role matches the login tab selected
        if (finalRole !== selectedTab) {
          // Immediately sign out to prevent unauthorized access
          await supabase.auth.signOut()
          throw new Error(`Unauthorized: This account is registered as a ${finalRole}, not an ${selectedTab}.`)
        }
      }

      addToast(`Successfully logged in as ${selectedTab}!`, 'success')
      onLoginSuccess(data.user)
    } catch (err) {
      addToast(err.message || 'Login failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <h2 className="auth-title">Welcome Back</h2>
        <p className="auth-subtitle" style={{ marginBottom: '20px' }}>Sign in to MediCare Connect</p>
        
        {/* Role Tab Selector */}
        <div style={{ 
          display: 'flex', 
          gap: '4px', 
          marginBottom: '24px', 
          background: 'var(--bg-input)', 
          padding: '4px', 
          borderRadius: '8px',
          border: '1px solid var(--border-color)'
        }}>
          <button 
            type="button" 
            className={`btn ${selectedTab === 'patient' ? 'btn-primary' : 'btn-secondary'}`} 
            style={{ flex: 1, padding: '8px 4px', fontSize: '0.85rem', borderRadius: '6px' }} 
            onClick={() => handleTabChange('patient')}
          >
            Patient
          </button>
          <button 
            type="button" 
            className={`btn ${selectedTab === 'doctor' ? 'btn-primary' : 'btn-secondary'}`} 
            style={{ flex: 1, padding: '8px 4px', fontSize: '0.85rem', borderRadius: '6px' }} 
            onClick={() => handleTabChange('doctor')}
          >
            Doctor
          </button>
          <button 
            type="button" 
            className={`btn ${selectedTab === 'admin' ? 'btn-primary' : 'btn-secondary'}`} 
            style={{ flex: 1, padding: '8px 4px', fontSize: '0.85rem', borderRadius: '6px' }} 
            onClick={() => handleTabChange('admin')}
          >
            Admin
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="email">
              {selectedTab.charAt(0).toUpperCase() + selectedTab.slice(1)} Email
            </label>
            <input 
              type="email" 
              id="email" 
              className="form-input" 
              placeholder={`${selectedTab}@example.com`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input 
              type="password" 
              id="password" 
              className="form-input" 
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '-8px', marginBottom: '16px' }}>
            <span 
              style={{ color: 'var(--primary)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500' }}
              onClick={() => {
                if (selectedTab === 'admin') {
                  setEmail('admin@example.com')
                  setPassword('admin123')
                } else if (selectedTab === 'doctor') {
                  setEmail('doctor@example.com')
                  setPassword('doctor123')
                } else {
                  setEmail('patient@example.com')
                  setPassword('patient123')
                }
              }}
            >
              💡 Autofill demo credentials
            </span>
          </div>

          <button type="submit" className="btn btn-primary btn-full" style={{ marginTop: '8px' }} disabled={loading}>
            {loading ? 'Logging in...' : `Log In as ${selectedTab.charAt(0).toUpperCase() + selectedTab.slice(1)}`}
          </button>
        </form>

        {selectedTab === 'patient' ? (
          <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            Don't have an account?{' '}
            <span 
              style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: '600' }} 
              onClick={navigateToRegister}
            >
              Create one
            </span>
          </div>
        ) : (
          <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            {selectedTab === 'doctor' 
              ? 'Doctor logins are provisioned by system administrators.' 
              : 'Admin login uses the pre-seeded credentials.'
            }
          </div>
        )}
      </div>
    </div>
  )
}

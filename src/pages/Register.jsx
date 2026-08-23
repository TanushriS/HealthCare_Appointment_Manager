import React, { useState } from 'react'
import { supabase } from '../services/supabase'

export default function Register({ onRegisterSuccess, addToast, navigateToLogin }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name || !email || !password) {
      addToast('Please fill in all required fields', 'warning')
      return
    }

    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
            role: 'patient' // Defaults to patient for self-signup
          }
        }
      })

      if (error) throw error

      if (data?.user) {
        // If phone is provided, let's update it in the profile
        if (phone) {
          const { error: updateErr } = await supabase
            .from('profiles')
            .update({ phone })
            .eq('id', data.user.id)
          if (updateErr) console.warn("Failed to save phone number", updateErr.message)
        }

        addToast('Registration successful! Please sign in.', 'success')
        navigateToLogin()
      } else {
        addToast('Registration process initiated. Please check your email.', 'info')
      }
    } catch (err) {
      addToast(err.message || 'Registration failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <h2 className="auth-title">Create Account</h2>
        <p className="auth-subtitle">Join MediCare Connect today</p>
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="name">Full Name *</label>
            <input 
              type="text" 
              id="name" 
              className="form-input" 
              placeholder="Jane Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="email">Email Address *</label>
            <input 
              type="email" 
              id="email" 
              className="form-input" 
              placeholder="jane@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="phone">Phone Number (Optional)</label>
            <input 
              type="tel" 
              id="phone" 
              className="form-input" 
              placeholder="+1234567890"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">Password *</label>
            <input 
              type="password" 
              id="password" 
              className="form-input" 
              placeholder="•••••••• (Min 6 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              minLength={6}
              required
            />
          </div>

          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          Already have an account?{' '}
          <span 
            style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: '600' }} 
            onClick={navigateToLogin}
          >
            Sign in
          </span>
        </div>
      </div>
    </div>
  )
}

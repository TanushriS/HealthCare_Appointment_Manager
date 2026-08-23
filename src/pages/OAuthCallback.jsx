import React, { useEffect, useState, useRef } from 'react'
import { exchangeOAuthCode } from '../services/googleCalendar'

export default function OAuthCallback({ addToast, onComplete }) {
  const [status, setStatus] = useState('processing') // 'processing' | 'success' | 'failed'
  const processedRef = useRef(false)

  useEffect(() => {
    if (processedRef.current) return
    processedRef.current = true

    // Check for access_token in hash fragment (Implicit Flow redirect from Google)
    const hashParams = new URLSearchParams(window.location.hash.substring(1))
    const accessToken = hashParams.get('access_token')
    const expiresIn = hashParams.get('expires_in')

    // Check for authorization code in search parameters (Auth Code Flow redirect)
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const error = params.get('error') || hashParams.get('error')

    if (error) {
      console.error("Google OAuth redirect error:", error)
      setStatus('failed')
      addToast(`Google Authentication failed: ${error}`, 'error')
      setTimeout(() => onComplete(), 3000)
      return
    }

    const processOAuth = async () => {
      if (accessToken) {
        // Implicit Flow (Mock Mode) - Save real token directly in mock DB
        const mockUser = JSON.parse(localStorage.getItem('mc_session'))
        const tokens = JSON.parse(localStorage.getItem('user_oauth_tokens') || '[]')
        const mockToken = {
          user_id: mockUser?.id || 'doc-id-123',
          access_token: accessToken,
          expiry_time: new Date(Date.now() + (parseInt(expiresIn) || 3600) * 1000).toISOString(),
          updated_at: new Date().toISOString()
        }
        const existingIdx = tokens.findIndex(t => t.user_id === mockToken.user_id)
        if (existingIdx > -1) {
          tokens[existingIdx] = mockToken
        } else {
          tokens.push(mockToken)
        }
        localStorage.setItem('user_oauth_tokens', JSON.stringify(tokens))
        
        setStatus('success')
        addToast('Successfully synced Google Calendar!', 'success')
      } else if (code) {
        // Auth Code Flow (Live Mode) - Exchange via Edge Function
        const success = await exchangeOAuthCode(code)
        if (success) {
          setStatus('success')
          addToast('Successfully synced Google Calendar!', 'success')
        } else {
          setStatus('failed')
          addToast('Failed to exchange Google Calendar tokens.', 'error')
        }
      } else {
        setStatus('failed')
        addToast('No authorization credentials found in redirect URL', 'error')
      }
      setTimeout(() => onComplete(), 2000)
    }

    processOAuth()
  }, [addToast, onComplete])

  return (
    <div className="auth-wrapper">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <h2 className="auth-title">Google Authentication</h2>
        
        {status === 'processing' && (
          <div style={{ marginTop: '20px' }}>
            <p>🔄 Exchanging authorization tokens with Google...</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '8px' }}>Please do not close this window.</p>
          </div>
        )}

        {status === 'success' && (
          <div style={{ marginTop: '20px', color: 'var(--success)' }}>
            <p>✅ Calendar Synced Successfully!</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '8px' }}>Redirecting back to dashboard...</p>
          </div>
        )}

        {status === 'failed' && (
          <div style={{ marginTop: '20px', color: 'var(--danger)' }}>
            <p>❌ Authentication Failed</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '8px' }}>Returning to dashboard...</p>
          </div>
        )}
      </div>
    </div>
  )
}

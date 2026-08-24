import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('MediCare Connect ErrorBoundary caught an error:', error, errorInfo)
    this.setState({ errorInfo })
  }

  handleReload = () => {
    window.location.reload()
  }

  handleReset = () => {
    localStorage.removeItem('mc_session')
    window.location.href = '/'
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="auth-wrapper" style={{ padding: '20px' }}>
          <div className="auth-card" style={{ maxWidth: '560px', textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '16px' }}>⚠️</div>
            <h2 style={{ marginBottom: '8px' }}>Something went wrong</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '20px', fontSize: '0.9rem' }}>
              An error occurred while loading this view:
            </p>
            <div style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              padding: '12px',
              color: '#ef4444',
              fontSize: '0.85rem',
              textAlign: 'left',
              fontFamily: 'monospace',
              marginBottom: '20px',
              wordBreak: 'break-word',
              maxHeight: '150px',
              overflowY: 'auto'
            }}>
              {this.state.error?.toString() || 'Unknown error'}
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={this.handleReload}>
                🔄 Reload Page
              </button>
              <button className="btn btn-secondary" onClick={this.handleReset}>
                🚪 Return to Login
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

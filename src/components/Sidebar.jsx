import React from 'react'

export default function Sidebar({ user, profile, activeTab, setActiveTab, onLogout }) {
  if (!user || !profile) return null

  const getMenuItems = () => {
    switch (profile.role) {
      case 'admin':
        return [
          { id: 'doctors', label: 'Manage Doctors', icon: '🩺' },
          { id: 'appointments', label: 'All Appointments', icon: '🗓️' },
          { id: 'notifications', label: 'Notification Logs', icon: '✉️' }
        ]
      case 'doctor':
        return [
          { id: 'schedule', label: 'My Schedule', icon: '🗓️' },
          { id: 'leaves', label: 'Manage Leave', icon: '🏖️' }
        ]
      case 'patient':
        return [
          { id: 'book', label: 'Book Appointment', icon: '➕' },
          { id: 'my-appointments', label: 'My Appointments', icon: '📋' }
        ]
      default:
        return []
    }
  }

  const menuItems = getMenuItems()

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span>MediCare Connect</span>
      </div>

      <div style={{ marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border-color)' }}>
        <p style={{ fontWeight: '600', fontSize: '0.95rem', color: '#fff' }}>{profile.name || 'User'}</p>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px' }}>{profile.email}</p>
        <span className={`badge badge-confirmed`} style={{ fontSize: '0.65rem', padding: '2px 8px' }}>
          {profile.role.toUpperCase()}
        </span>
      </div>

      <nav style={{ flex: 1 }}>
        <ul className="sidebar-menu">
          {menuItems.map((item) => (
            <li 
              key={item.id} 
              className={`sidebar-item ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      </nav>

      <div className="sidebar-footer">
        <button className="btn btn-secondary btn-full" onClick={onLogout}>
          🚪 Log Out
        </button>
      </div>
    </aside>
  )
}

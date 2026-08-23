import React, { useEffect } from 'react'

export default function Toast({ toasts, onDismiss }) {
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <ToastItem 
          key={toast.id} 
          toast={toast} 
          onDismiss={onDismiss} 
        />
      ))}
    </div>
  )
}

function ToastItem({ toast, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id)
    }, 4000) // Auto-dismiss after 4 seconds

    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  const getToastClass = () => {
    switch (toast.type) {
      case 'success':
        return 'toast toast-success'
      case 'error':
        return 'toast toast-error'
      case 'warning':
        return 'toast toast-warning'
      default:
        return 'toast'
    }
  }

  return (
    <div className={getToastClass()}>
      <span>{toast.message}</span>
      <button 
        style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', marginLeft: 'auto', fontWeight: 'bold' }} 
        onClick={() => onDismiss(toast.id)}
      >
        &times;
      </button>
    </div>
  )
}

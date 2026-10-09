import React, { useEffect, useRef } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import '../confirmation-dialog.css'

export default function ConfirmationDialog({ confirmation, busy, onCancel, onConfirm }) {
  const cancelRef = useRef(null)

  useEffect(() => {
    if (!confirmation) return undefined
    cancelRef.current?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, confirmation, onCancel])

  if (!confirmation) return null

  return (
    <div className="confirm-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && onCancel()}>
      <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
        <button className="confirm-close" type="button" aria-label="Close confirmation" onClick={onCancel} disabled={busy}><X size={17} /></button>
        <div className="confirm-icon"><AlertTriangle size={20} /></div>
        <h2 id="confirm-title">{confirmation.title}</h2>
        <p id="confirm-description">{confirmation.description}</p>
        <div className="confirm-actions">
          <button ref={cancelRef} className="button ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="button confirm-destructive" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? 'Please wait…' : confirmation.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

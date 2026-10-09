import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import '../toast-notice.css'

const icons = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
}

export default function ToastNotice({ notice, onDismiss }) {
  const dismissRef = useRef(onDismiss)

  useEffect(() => {
    dismissRef.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    if (notice?.type !== 'success') return undefined
    const timer = window.setTimeout(() => dismissRef.current(), 3000)
    return () => window.clearTimeout(timer)
  }, [notice?.type, notice?.text])

  if (!notice || notice.type === 'analyze') return null
  const Icon = icons[notice.type] || Info

  return (
    <div className={`toast-notice ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'} aria-live="polite">
      <Icon size={17} aria-hidden="true" />
      <span>{notice.text || (notice.type === 'error' ? 'Something went wrong. Please try again.' : 'Done.')}</span>
      <button type="button" aria-label="Dismiss notification" onClick={onDismiss}><X size={15} /></button>
    </div>
  )
}

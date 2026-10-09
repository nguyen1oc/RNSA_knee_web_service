import React from 'react'
import { Clock3, RotateCcw } from 'lucide-react'
import '../session-controls.css'

export default function SessionControls({ onClear, disabled }) {
  return (
    <div className="session-controls">
      <span className="session-status" title="Uploads are isolated to this browser session and removed when you clear it or it expires."><Clock3 size={14} /> Temporary workspace</span>
      <button className="button ghost session-clear" onClick={onClear} disabled={disabled}><RotateCcw size={14} /> Clear session</button>
    </div>
  )
}

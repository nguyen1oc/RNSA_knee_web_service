import { Printer, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import { analysisTargets, getScoreBand } from '../analysisResults'
import './export-results-modal.css'

function exportDate(value) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(new Date(value))
}

export default function ExportResultsModal({ study, result, onClose }) {
  const [exportedAt] = useState(() => new Date().toISOString())
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return createPortal(
    <div className="export-results-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="export-results-dialog" role="dialog" aria-modal="true" aria-labelledby="export-results-title">
        <header className="export-results-toolbar">
          <h2 id="export-results-title">Export preview</h2>
          <button className="icon-button" type="button" aria-label="Close export preview" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <article className="export-results-sheet">
          <h1>RSNA Knee Review</h1>
          <div className="export-results-study">
            <span>Study UID</span>
            <b>{study.study_uid}</b>
          </div>
          <p className="export-results-date">Date: {exportDate(exportedAt)}</p>
          <div className="export-results-list" aria-label="Study prediction scores">
            {analysisTargets.map(({ id, name }) => {
              const band = getScoreBand(result.scores[id])
              const highScore = band?.key === 'high'
              return (
                <div className={`export-results-row${highScore ? ' high-score' : ''}`} key={id}>
                  <span>{name}</span>
                  <b>{band ? <><span>{band.label}</span><small>{band.translation}</small></> : '—'}</b>
                </div>
              )
            })}
          </div>
          <p className="export-results-footnote">Displayed as four model-confidence bands for positive findings. The model score is not a calibrated clinical probability. AI predictions are for reference only; final interpretation and diagnosis are the responsibility of the physician.</p>
        </article>

        <footer className="export-results-actions">
          <button className="button ghost" type="button" onClick={onClose}>Close</button>
          <button className="button primary" type="button" onClick={() => window.print()}>
            <Printer size={14} /> Print / Save PDF
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}

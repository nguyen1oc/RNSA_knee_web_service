import { Printer, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import { groupAnalysisScores, modelSignalLevel } from '../analysisResults'
import './export-results-modal.css'
import './export-results-print.css'
import './model-signal.css'

function exportDate(value) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(new Date(value))
}

export default function ExportResultsModal({ study, result, onClose }) {
  const [exportedAt] = useState(() => new Date().toISOString())
  const { atOrAboveThreshold } = groupAnalysisScores(result.scores)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return createPortal(
    <div className="export-results-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="export-results-dialog" role="dialog" aria-modal="true" aria-labelledby="export-results-title">
        <header className="export-results-toolbar">
          <h2 id="export-results-title">Export preview</h2>
          <button className="icon-button" type="button" aria-label="Close export preview" onClick={onClose}><X size={16} /></button>
        </header>
        <article className="export-results-sheet">
          <h1>RSNA Knee Review</h1>
          <div className="export-results-study"><span>Study UID</span><b>{study.study_uid}</b></div>
          <p className="export-results-date">Date: {exportDate(exportedAt)}</p>
          <h2 className="export-results-score-heading">AI-flagged findings</h2>
          <div className="export-results-list" aria-label="AI-flagged findings for this study">
            {atOrAboveThreshold.map(({ id, name, score }) => (
              <div className={`export-results-row${modelSignalLevel(score).key === 'strong' ? ' high-score' : ''}`} key={id}>
                <span>{name}</span><b className={`model-signal--${modelSignalLevel(score).key}`}>{modelSignalLevel(score).label}</b>
              </div>
            ))}
            {atOrAboveThreshold.length === 0 && <p className="export-results-empty">No model signals reached the moderate or strong range.</p>}
          </div>
          <p className="export-results-footnote">AI predictions are for reference only. Final interpretation and diagnosis are the responsibility of the physician.</p>
        </article>
        <footer className="export-results-actions">
          <button className="button ghost" type="button" onClick={onClose}>Close</button>
          <button className="button primary" type="button" onClick={() => window.print()}><Printer size={14} /> Print / Save PDF</button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}

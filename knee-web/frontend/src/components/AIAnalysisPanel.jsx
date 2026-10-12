import { ArrowLeft, Download, Info, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { analysisTargets } from '../analysisResults'
import ExportResultsModal from './ExportResultsModal'
import './analysis-details.css'

function scoreColor(score) {
  const hue = Math.max(0, Math.min(120, 120 - Number(score) * 120))
  return `hsl(${hue} 58% 38%)`
}

function formattedDate(value) {
  const date = value ? new Date(value) : new Date()
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default function AIAnalysisPanel({ study, result, onShowStudyInfo }) {
  const [showExportPreview, setShowExportPreview] = useState(false)
  const inferenceComplete = result.status === 'complete'

  return (
    <aside className="study-info-panel ai-analysis-panel" aria-label="AI analysis results">
      <div className="analysis-panel-heading">
        <div><p className="eyebrow">Study results</p><h3>AI Analysis</h3></div>
        <button className="button ghost analysis-back-button" onClick={onShowStudyInfo}>
          <ArrowLeft size={14} /> Study information
        </button>
      </div>
      <div className="analysis-model-warning" role="status">
        <Info size={15} />
        <span>{inferenceComplete
          ? 'AI predictions are for reference only. Final interpretation and diagnosis are the responsibility of the physician.'
          : 'Inference is unavailable. No model scores are shown.'}</span>
      </div>
      <section className="analysis-config analysis-details" aria-label="Prediction details">
        <h4><Sparkles size={14} /> Prediction details</h4>
        <div className="analysis-config-details">
          <div><span>Prediction unit</span><b>Study-level</b></div>
          <div><span>Generated</span><b>{formattedDate(result.created_at)}</b></div>
        </div>
      </section>
      <div className="analysis-study-meta">
        <div className="analysis-study-uid"><span>Study UID</span><b>{study.study_uid}</b></div>
      </div>
      <div className="analysis-score-heading"><span>12 target scores</span><span>Score</span></div>
      <ul className="analysis-score-list">
        {analysisTargets.map(({ id, name, translation }) => {
          const rawScore = result.scores?.[id]
          const hasScore = inferenceComplete && Number.isFinite(Number(rawScore))
          const score = hasScore ? Number(rawScore) * 100 : null
          return (
            <li className={`analysis-score-row${score > 75 ? ' high-score' : ''}`} key={id}>
              <span className="analysis-target-name"><b>{name}</b><small>{translation}</small></span>
              <b className="analysis-score-value" style={score === null ? undefined : { color: scoreColor(score / 100) }}>
                {score === null ? '—' : `${score.toFixed(0)}%`}
              </b>
            </li>
          )
        })}
      </ul>
      <button className="button primary analysis-export-button" disabled={!inferenceComplete} onClick={() => setShowExportPreview(true)}>
        <Download size={14} /> Export results
      </button>
      <p className="analysis-session-note">This result is kept for this study in the current browser session.</p>
      {showExportPreview && <ExportResultsModal study={study} result={result} onClose={() => setShowExportPreview(false)} />}
    </aside>
  )
}

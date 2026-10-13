import { ArrowLeft, ChevronDown, Download, Info, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { groupAnalysisScores, modelSignalLevel } from '../analysisResults'
import ExportResultsModal from './ExportResultsModal'
import './analysis-details.css'
import './analysis-score-summary.css'
import './model-signal.css'

function formattedDate(value) {
  const date = value ? new Date(value) : new Date()
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default function AIAnalysisPanel({ study, result, onShowStudyInfo }) {
  const [showExportPreview, setShowExportPreview] = useState(false)
  const [showAllScores, setShowAllScores] = useState(false)
  const inferenceComplete = result.status === 'complete'
  const { atOrAboveThreshold, remaining } = groupAnalysisScores(inferenceComplete ? result.scores : {})
  const visibleScores = showAllScores ? [...atOrAboveThreshold, ...remaining] : atOrAboveThreshold
  let scoreHeading = `AI-flagged findings (${atOrAboveThreshold.length})`
  if (!inferenceComplete) scoreHeading = 'Model targets'
  else if (showAllScores) scoreHeading = 'All 12 model targets'

  useEffect(() => { setShowAllScores(false) }, [study.id, result])

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
      <div className="analysis-score-heading">
        <span>{scoreHeading}</span>
        <span>Model signal</span>
      </div>
      {inferenceComplete && !showAllScores && atOrAboveThreshold.length === 0 && (
        <p className="analysis-score-empty">No model signals reached the moderate or strong range.</p>
      )}
      <ul className="analysis-score-list">
        {inferenceComplete && visibleScores.map(({ id, name, translation, score }) => (
          <li className={`analysis-score-row${modelSignalLevel(score).key === 'strong' ? ' high-score' : ''}`} key={id}>
            <span className="analysis-target-name"><b>{name}</b><small>{translation}</small></span>
            <b className={`analysis-score-value model-signal--${modelSignalLevel(score).key}`}>
              {modelSignalLevel(score).label}
            </b>
          </li>
        ))}
      </ul>
      {inferenceComplete && remaining.length > 0 && (
        <button
          className="button ghost analysis-expand-button"
          type="button"
          aria-expanded={showAllScores}
          onClick={() => setShowAllScores((current) => !current)}
        >
          <ChevronDown size={14} aria-hidden="true" />
          {showAllScores ? 'Show flagged findings only' : `Show all 12 targets (${remaining.length} more)`}
        </button>
      )}
      <button className="button primary analysis-export-button" disabled={!inferenceComplete} onClick={() => setShowExportPreview(true)}>
        <Download size={14} /> Export results
      </button>
      <p className="analysis-session-note">This result is kept for this study in the current browser session.</p>
      {showExportPreview && <ExportResultsModal study={study} result={result} onClose={() => setShowExportPreview(false)} />}
    </aside>
  )
}

import { BrainCircuit } from 'lucide-react'
import { useEffect } from 'react'
import './analysis-loading-modal.css'

export default function AnalysisLoadingModal({ open, studyName }) {
  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [open])

  if (!open) return null

  return (
    <div className="analysis-loading-backdrop">
      <section className="analysis-loading-dialog" role="dialog" aria-modal="true" aria-labelledby="analysis-loading-title">
        <div className="analysis-loading-icon"><BrainCircuit size={22} aria-hidden="true" /></div>
        <p className="eyebrow">AI analysis</p>
        <h2 id="analysis-loading-title">Analyzing study</h2>
        <p className="analysis-loading-study" title={studyName}>{studyName || 'Selected study'}</p>
        <div className="analysis-loading-progress" role="status" aria-label="Inference in progress"><span /></div>
        <p className="analysis-loading-message">Preparing DICOM series and running the model. This may take a few minutes; keep this page open.</p>
      </section>
    </div>
  )
}

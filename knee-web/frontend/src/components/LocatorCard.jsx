import { Info } from 'lucide-react'
import KneeReferenceModel from './KneeReferenceModel'

export default function LocatorCard({ activeSeries }) {
  return (
    <article className="viewer-card locator-card">
      <div className="card-head">
        <div><span className="card-kicker">Reference anatomy</span><h3>3D locator</h3></div>
        <span className="planned-badge">Not patient-specific</span>
      </div>
      <KneeReferenceModel />
      <div className="card-foot">
        <span><Info size={13} /> Generic model · not aligned to this study. <a href="https://3d.nih.gov/entries/3DPX-021004" target="_blank" rel="noreferrer">Human Reference Atlas · CC BY 4.0</a></span>
      </div>
    </article>
  )
}

import { Info } from 'lucide-react'

export default function LocatorCard({ activeSeries, studyGeometry }) {
  const mappingReady = Boolean(studyGeometry?.mapping_ready)

  return (
    <article className="viewer-card locator-card">
      <div className="card-head">
        <div><span className="card-kicker">Orientation</span><h3>3D locator</h3></div>
        <span className="planned-badge">P1</span>
      </div>
      <div className="locator-stage">
        <div className="locator-cube">
          <div className="cube-face cube-front" />
          <div className="cube-face cube-side" />
          <div className="cube-face cube-top" />
          <span className="axis-label axis-x">R</span>
          <span className="axis-label axis-y">A</span>
          <span className="axis-label axis-z">S</span>
        </div>
        <div className="crosshair crosshair-h" />
        <div className="crosshair crosshair-v" />
        <span className="locator-caption">{activeSeries ? `${activeSeries.plane} series selected` : 'Select a series'}</span>
      </div>
      <div className="card-foot">
        <span><Info size={13} /> {mappingReady ? 'Geometry validated · patient mapping ready' : 'Orientation locator only · geometry mapping unavailable'}</span>
      </div>
    </article>
  )
}

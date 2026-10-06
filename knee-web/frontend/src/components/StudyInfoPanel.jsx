import { Info } from 'lucide-react'

export default function StudyInfoPanel({ study }) {
  const stages = study.pipeline?.stages || []
  const geometries = study.series.map((series) => series.geometry || { status: series.geometry_status || 'unknown', mapping_ready: false })
  const validGeometry = geometries.filter((geometry) => geometry.status === 'valid').length
  const mappingSummary = study.geometry?.mapping_ready ? 'Ready' : study.geometry?.status === 'incompatible' ? 'Incompatible frames' : 'Unavailable'

  return (
    <aside className="study-info-panel" aria-label="Study information">
      <p className="eyebrow">Study information</p>
      <h3>Source details</h3>
      <span className={`info-status ${study.source}`}>{study.source === 'sample' ? 'Example study' : 'Imported study'}</span>
      <div className="info-rows">
        <div><span>Input</span><b>DICOM `.dcm`</b></div>
        <div><span>Series</span><b>{study.series.length}</b></div>
        <div><span>Images</span><b>{study.total_slices}</b></div>
        <div><span>Geometry</span><b>{validGeometry} / {geometries.length} valid</b></div>
        <div><span>3D mapping</span><b>{mappingSummary}</b></div>
        <div><span>Study UID</span><b title={study.study_uid}>…{study.study_uid.slice(-12)}</b></div>
      </div>
      <div className="info-divider" />
      <p className="eyebrow">Ingest pipeline</p>
      <ul className="pipeline-list">
        {stages.map((stage) => <li key={stage.key}><span className={`pipeline-dot ${stage.status}`} /><span>{stage.label}</span><small>{stage.status === 'on_demand' ? 'On demand' : 'Complete'}</small></li>)}
      </ul>
      <div className="info-note"><Info size={14} /><span>Display controls affect presentation only. Source DICOM files remain unchanged.</span></div>
    </aside>
  )
}

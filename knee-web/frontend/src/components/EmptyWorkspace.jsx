import { FileArchive, UploadCloud } from 'lucide-react'

export default function EmptyWorkspace({ onImport }) {
  return (
    <div className="empty-workspace">
      <div className="empty-illustration"><UploadCloud size={34} /></div>
      <p className="eyebrow">Local DICOM workspace</p>
      <h2>Start a knee image review</h2>
      <p>Import a study to browse its series and slices. Files stay on this machine; no account or AI service is required.</p>
      <button className="button primary" onClick={onImport}><UploadCloud size={16} /> Import DICOM study</button>
      <div className="empty-note"><FileArchive size={15} /> Supports individual <b>.dcm</b> files and folders. ZIP import will be added later.</div>
    </div>
  )
}

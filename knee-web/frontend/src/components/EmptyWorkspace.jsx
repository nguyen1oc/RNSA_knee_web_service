import { Info, UploadCloud } from 'lucide-react'
import ImportStudyMenu from './ImportStudyMenu'

export default function EmptyWorkspace({ onImportFiles, onImportFolder, disabled = false }) {
  return (
    <div className="empty-workspace">
      <div className="empty-illustration"><UploadCloud size={34} /></div>
      <p className="eyebrow">Temporary DICOM workspace</p>
      <h2>Start a knee image review</h2>
      <p>Import a study to browse its series and slices. No account or AI analysis is required.</p>
      <ImportStudyMenu onFiles={onImportFiles} onFolder={onImportFolder} disabled={disabled} />
      <div className="empty-note"><Info size={15} /> Choose Files / ZIP for multiple <b>.dcm</b> files or an archive, or Folder for the full Study folder. A Series folder imports only that Series.</div>
    </div>
  )
}

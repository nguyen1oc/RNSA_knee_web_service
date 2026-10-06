import { X } from 'lucide-react'

export default function CaptureModal({ open, series, slicePosition, annotationCount, onClose, onExport }) {
  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="capture-modal" role="dialog" aria-modal="true" aria-labelledby="capture-title">
        <div className="capture-head">
          <div>
            <span className="eyebrow">EXPORT VIEWPORT</span>
            <h3 id="capture-title">Capture image</h3>
            <p>{series?.description || 'Current DICOM viewport'} · slice {slicePosition}</p>
          </div>
          <button className="icon-button" aria-label="Close capture dialog" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="capture-form">
          <label>Format<select name="format" defaultValue="png"><option value="png">PNG · lossless</option><option value="jpg">JPEG · compressed</option></select></label>
          <label>Image size<select name="size" defaultValue="native"><option value="native">Native viewport</option><option value="1024">1024 px</option><option value="2048">2048 px</option><option value="custom">Custom 1600 px</option></select></label>
          <label className="capture-check"><input name="includeAnnotations" type="checkbox" defaultChecked /> Include annotations ({annotationCount})</label>
          <label className="capture-check"><input name="includeMetadata" type="checkbox" defaultChecked /> Include slice and orientation metadata</label>
        </div>

        <div className="capture-actions">
          <button className="button ghost" onClick={onClose}>Cancel</button>
          <button className="button primary" onClick={(event) => {
            const form = event.currentTarget.closest('.capture-modal')
            onExport({
              format: form.querySelector('[name="format"]').value,
              size: form.querySelector('[name="size"]').value,
              includeAnnotations: form.querySelector('[name="includeAnnotations"]').checked,
              includeMetadata: form.querySelector('[name="includeMetadata"]').checked,
            })
          }}>Download image</button>
        </div>
      </section>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import '../capture-preview.css'

const initialSettings = {
  format: 'png',
  size: '512',
  includeAnnotations: true,
  includeMetadata: true,
}

export default function CaptureModal({ open, series, slicePosition, annotationCount, onClose, onPreview, onExport }) {
  const [settings, setSettings] = useState(initialSettings)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [previewing, setPreviewing] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    let objectUrl = ''
    setPreviewing(true)
    setPreviewError('')
    setPreviewUrl('')
    onPreview(settings)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setPreviewUrl(objectUrl)
      })
      .catch((error) => { if (!cancelled) setPreviewError(error.message || 'Preview unavailable.') })
      .finally(() => { if (!cancelled) setPreviewing(false) })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [open, settings, onPreview])

  if (!open) return null

  const update = (event) => {
    const { name, value, checked, type } = event.target
    setSettings((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }))
  }

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

        <div className="capture-preview-layout">
          <div className="capture-preview-column">
            <div className="capture-preview-frame" aria-label="Capture preview">
              {previewUrl && <img src={previewUrl} alt={`Preview of ${series?.description || 'current DICOM viewport'}, slice ${slicePosition}`} />}
              {previewing && <span className="capture-preview-state">Preparing preview…</span>}
              {previewError && <span className="capture-preview-state capture-preview-error">{previewError}</span>}
            </div>
            <span className="capture-preview-caption">Preview · {settings.size} × {settings.size} · {settings.format.toUpperCase()}</span>
          </div>

          <div className="capture-options-column">
            <div className="capture-form">
              <label>Format<select name="format" value={settings.format} onChange={update}><option value="png">PNG · lossless</option><option value="jpg">JPEG · compressed</option></select></label>
              <label>Image size<select name="size" value={settings.size} onChange={update}><option value="64">64 × 64</option><option value="128">128 × 128</option><option value="512">512 × 512</option></select></label>
              <label className="capture-check"><input name="includeAnnotations" type="checkbox" checked={settings.includeAnnotations} onChange={update} /> Include annotations ({annotationCount})</label>
              <label className="capture-check"><input name="includeMetadata" type="checkbox" checked={settings.includeMetadata} onChange={update} /> Include slice and orientation metadata</label>
            </div>
            <div className="capture-actions">
              <button className="button ghost" onClick={onClose}>Cancel</button>
              <button className="button primary" disabled={!previewUrl || previewing} onClick={() => onExport(settings)}>Download image</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

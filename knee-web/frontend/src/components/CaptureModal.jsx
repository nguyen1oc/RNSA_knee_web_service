import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

export default function CaptureModal({ open, series, slicePosition, annotationCount, onClose, onPreview, onExport }) {
  const [options, setOptions] = useState({ format: 'png', size: '512', includeAnnotations: true, includeMetadata: true })
  const [preview, setPreview] = useState({ url: '', blob: null, loading: false, error: '' })
  const [dimensions, setDimensions] = useState('')

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    let previewUrl = ''
    setPreview({ url: '', blob: null, loading: true, error: '' })
    setDimensions('')
    Promise.resolve().then(() => onPreview(options)).then((blob) => {
      if (cancelled) return
      if (!blob) throw new Error('The selected viewport is still loading.')
      previewUrl = URL.createObjectURL(blob)
      setPreview({ url: previewUrl, blob, loading: false, error: '' })
    }).catch((error) => {
      if (!cancelled) setPreview({ url: '', blob: null, loading: false, error: error.message || 'Preview unavailable.' })
    })
    return () => {
      cancelled = true
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [open, options, onPreview])

  if (!open) return null

  const update = (key, value) => setOptions((current) => ({ ...current, [key]: value }))

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

        <div className="capture-body">
          <section className="capture-preview-section" aria-label="Image export preview">
            <div className="capture-preview-frame">
              {preview.url && <img src={preview.url} alt="Preview of exported DICOM viewport" onLoad={(event) => setDimensions(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)} />}
              {preview.loading && <span className="capture-preview-message">Preparing preview…</span>}
              {preview.error && <span className="capture-preview-message error">{preview.error}</span>}
            </div>
            <div className="capture-preview-meta"><span>Preview · current window/level, zoom and pan</span><span>{dimensions}</span></div>
          </section>
          <div className="capture-form">
            <label>Format<select name="format" value={options.format} onChange={(event) => update('format', event.target.value)}><option value="png">PNG · lossless</option><option value="jpg">JPEG · compressed</option></select></label>
            <label>Image size<select name="size" value={options.size} onChange={(event) => update('size', event.target.value)}><option value="512">512 × 512 px</option><option value="256">256 × 256 px</option><option value="128">128 × 128 px</option></select></label>
            <small className="capture-size-help">The image is fit inside the square without cropping or stretching.</small>
            <label className="capture-check"><input name="includeAnnotations" type="checkbox" checked={options.includeAnnotations} onChange={(event) => update('includeAnnotations', event.target.checked)} /> Include annotations ({annotationCount})</label>
            <label className="capture-check"><input name="includeMetadata" type="checkbox" checked={options.includeMetadata} onChange={(event) => update('includeMetadata', event.target.checked)} /> Include slice and orientation metadata</label>
          </div>
        </div>

        <div className="capture-actions">
          <button className="button ghost" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={!preview.blob || preview.loading} onClick={() => onExport(options, preview.blob)}>Download image</button>
        </div>
      </section>
    </div>
  )
}

import { Image as ImageIcon } from 'lucide-react'

export default function ImageCard({
  title,
  series,
  active,
  interactive = active,
  slice,
  slicePosition,
  focused = false,
  zoom,
  fit,
  pan = { x: 0, y: 0 },
  contrast,
  brightness,
  inverted,
  onSelect,
  onActivate,
  onResetView,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}) {
  const available = Boolean(series)
  const loading = available && !slice
  const imageFilter = `${inverted ? 'invert(1) ' : ''}contrast(${contrast}) brightness(${brightness})`
  const canPan = interactive && available && !loading && (zoom > 1 || !fit)
  const resetDisabled = !interactive || (zoom === 1 && fit && pan.x === 0 && pan.y === 0)

  return (
    <article className={`viewer-card image-card ${active ? 'active' : ''} ${focused ? 'focused' : ''}`}>
      <div className="card-head">
        <div>
          <span className="card-kicker">{title}</span>
          <h3>{available ? series.description || 'DICOM series' : 'Not available'}</h3>
        </div>
        <div className="card-actions">
          {available && <button className="card-open" onClick={onSelect} aria-label={`Open ${title} view`}>Open</button>}
          {available && <button className="card-reset" onClick={onResetView} aria-label={`Reset ${title} view`} disabled={resetDisabled}>Reset view</button>}
        </div>
      </div>

      <div
        className={`image-stage ${!available || loading ? 'unavailable' : ''} ${canPan ? 'zoomed can-pan' : ''}`}
        onWheel={interactive && available && !loading ? onWheel : undefined}
        onPointerDown={canPan ? onPointerDown : undefined}
        onPointerMove={canPan ? onPointerMove : undefined}
        onPointerUp={canPan ? onPointerUp : undefined}
        onPointerCancel={canPan ? onPointerCancel : undefined}
        onClick={available && !loading ? onActivate : undefined}
      >
        {available && slice ? (
          <img
            src={slice.image_url}
            alt={`${title} DICOM slice`}
            draggable="false"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              filter: imageFilter,
              opacity: fit ? 1 : 0.98,
            }}
          />
        ) : (
          <div className="unavailable-copy">
            <ImageIcon size={24} />
            <b>{loading ? 'Loading slice…' : `No ${title.toLowerCase()} series`}</b>
            <span>{loading ? 'Preparing the first image for this acquisition.' : `This study does not contain a mapped ${title.toLowerCase()} acquisition.`}</span>
          </div>
        )}
      </div>

      <div className="card-foot">
        {available ? <span>{slicePosition || `${series.slice_count} slices`} · {series.rows} × {series.cols}</span> : <span>Direction unavailable</span>}
        {active && <span className="selected-label">Active</span>}
      </div>
    </article>
  )
}

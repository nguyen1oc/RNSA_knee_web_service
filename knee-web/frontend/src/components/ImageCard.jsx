import { Image as ImageIcon } from 'lucide-react'

export default function ImageCard({
  title,
  series,
  active,
  interactive = active,
  slice,
  slicePosition,
  focused = false,
  showOpen = true,
  showTitle = true,
  resetLabel = 'Reset view',
  overlay = null,
  sliceRail = null,
  forcePointerInteraction = false,
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
  onImageLoad,
}) {
  const available = Boolean(series)
  const loading = available && !slice
  const imageFilter = `${inverted ? 'invert(1) ' : ''}contrast(${contrast}) brightness(${brightness})`
  const canPan = interactive && available && !loading && (zoom > 1 || !fit)
  const pointerEnabled = available && !loading && (canPan || forcePointerInteraction)
  const resetDisabled = !interactive || (zoom === 1 && fit && pan.x === 0 && pan.y === 0)
  const selectable = Boolean(onActivate && available)

  const handleCardKeyDown = (event) => {
    if (!selectable || event.target.closest('button, select, input, a')) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onActivate()
    }
  }

  return (
    <article
      className={`viewer-card image-card ${active ? 'active' : ''} ${focused ? 'focused' : ''} ${selectable ? 'selectable' : ''}`}
      onClick={(event) => {
        if (selectable && !event.target.closest('button, select, input, a')) onActivate()
      }}
      onKeyDown={handleCardKeyDown}
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
    >
      <div className="card-head">
        <div>
          <span className="card-kicker">{title}</span>
          {showTitle && <h3>{available ? series.description || 'DICOM series' : 'Not available'}</h3>}
        </div>
        <div className="card-actions">
          {available && showOpen && <button className="card-open" onClick={onSelect} aria-label={`Open ${title} view`}>Open</button>}
          {available && <button className="card-reset" onClick={onResetView} aria-label={`Reset ${title} view`} disabled={resetDisabled}>{resetLabel}</button>}
        </div>
      </div>

      <div
        className={`image-stage ${!available || loading ? 'unavailable' : ''} ${canPan ? 'zoomed can-pan' : ''}`}
        onWheelCapture={pointerEnabled ? (event) => {
          if (event.target.closest('.slice-rail')) return
          onWheel(event)
        } : undefined}
        onPointerDown={pointerEnabled ? onPointerDown : undefined}
        onPointerMove={pointerEnabled ? onPointerMove : undefined}
        onPointerUp={pointerEnabled ? onPointerUp : undefined}
        onPointerCancel={pointerEnabled ? onPointerCancel : undefined}
      >
        {available && slice ? (
            <img
              src={slice.image_url}
              alt={`${title} DICOM slice`}
              draggable="false"
              onLoad={onImageLoad}
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
        {overlay}
        {sliceRail}
      </div>

      <div className="card-foot">
        {available ? <><span className="card-foot-title">{focused ? series.description || 'DICOM series' : (slicePosition || `${series.slice_count} slices`)}</span><span>{focused ? `${slicePosition || `${series.slice_count} slices`} · ${series.rows} × ${series.cols}` : `${series.rows} × ${series.cols}`}</span></> : <span>Direction unavailable</span>}
        {active && <span className="selected-label">Active</span>}
      </div>
    </article>
  )
}

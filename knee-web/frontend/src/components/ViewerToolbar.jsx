import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react'

export default function ViewerToolbar({
  activeStudy,
  activeSeries,
  selectSeries,
  currentIndex,
  slices,
  setSliceIndex,
  activeView,
  changeZoom,
  resetView,
}) {
  const maxSliceIndex = Math.max(slices.length - 1, 0)

  return (
    <div className="viewer-toolbar">
      <div className="toolbar-group">
        <label>Active series</label>
        <select value={activeSeries?.id || ''} onChange={(event) => selectSeries(activeStudy.series.find((series) => series.id === event.target.value))}>
          {activeStudy.series.map((series) => <option key={series.id} value={series.id}>{series.plane} · {series.description || 'DICOM series'} · {series.slice_count} slices</option>)}
        </select>
      </div>

      <div className="toolbar-group compact">
        <label>Slice</label>
        <button className="icon-button" aria-label="Previous slice" onClick={() => setSliceIndex(Math.max(0, currentIndex - 1))}><ChevronLeft size={16} /></button>
        <span className="slice-count">{slices.length ? `${currentIndex + 1} / ${slices.length}` : '—'}</span>
        <button className="icon-button" aria-label="Next slice" onClick={() => setSliceIndex(Math.min(maxSliceIndex, currentIndex + 1))}><ChevronRight size={16} /></button>
      </div>

      <div className="toolbar-spacer" />

      <div className="toolbar-group compact">
        <label>Zoom</label>
        <button className="icon-button" aria-label="Zoom out" onClick={() => changeZoom(activeSeries?.id, -0.25)} disabled={activeView.zoom === 1}><Minus size={15} /></button>
        <span className="zoom-value">{Math.round(activeView.zoom * 100)}%</span>
        <button className="icon-button" aria-label="Zoom in" onClick={() => changeZoom(activeSeries?.id, 0.25)}><Plus size={15} /></button>
        <button className="button ghost small" onClick={() => resetView(activeSeries?.id)}>Reset</button>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Camera, Circle, Crosshair, Grid2X2, Link2, Minus, MousePointer2, Pencil, Plus, Ruler, Square, Trash2, Type, Undo2 } from 'lucide-react'
import CaptureModal from './CaptureModal'
import ImageCard from './ImageCard'
import SliceRail from './SliceRail'

const presetLayouts = ['1x1', '2x2']

const tools = [
  { id: 'pointer', label: 'Pointer', icon: MousePointer2 },
  { id: 'length', label: 'Length', icon: Ruler },
  { id: 'rectangle', label: 'Rectangle', icon: Square },
  { id: 'ellipse', label: 'Ellipse', icon: Circle },
  { id: 'freehand', label: 'Freehand', icon: Pencil },
  { id: 'annotation', label: 'Arrow + note', icon: Type },
]

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)
const middleIndex = (length) => Math.max(0, Math.floor((length - 1) / 2))
const defaultViewport = () => ({ zoom: 1, pan: { x: 0, y: 0 }, fit: true })
const layoutDimensions = (value) => {
  const [rows, columns] = value.split('x').map(Number)
  return { rows, columns, count: rows * columns }
}

function metricFor(item, series) {
  const dx = Math.abs((item.x2 ?? item.x) - item.x)
  const dy = Math.abs((item.y2 ?? item.y) - item.y)
  const rows = Number(series?.rows) || 0
  const columns = Number(series?.cols) || 0
  const spacing = Array.isArray(series?.spacing) ? series.spacing.map(Number) : []
  const hasSpacing = spacing.length >= 2 && spacing.every((value) => Number.isFinite(value) && value > 0) && rows && columns
  if (item.type === 'length') {
    const pixels = Math.sqrt((dx * columns) ** 2 + (dy * rows) ** 2)
    if (!hasSpacing) return `${Math.round(pixels)} px`
    const mm = Math.sqrt((dx * columns * spacing[1]) ** 2 + (dy * rows * spacing[0]) ** 2)
    return `${mm.toFixed(1)} mm`
  }
  if (item.type === 'rectangle' || item.type === 'ellipse') {
    if (!hasSpacing) return `${Math.round(dx * columns)} × ${Math.round(dy * rows)} px`
    return `${(dx * columns * spacing[1]).toFixed(1)} × ${(dy * rows * spacing[0]).toFixed(1)} mm`
  }
  return ''
}

function viewportIndices(count, currentIndex, total) {
  const start = currentIndex ?? 0
  return Array.from({ length: count }, (_, index) => clamp(start + index, 0, Math.max(total - 1, 0)))
}

function AnnotationOverlay({ annotations, draft, series }) {
  const items = draft ? [...annotations, draft] : annotations
  return (
    <svg className="annotation-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs><marker id="annotation-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" /></marker></defs>
      {items.map((item) => {
        const x = item.x * 100
        const y = item.y * 100
        const width = (item.x2 - item.x) * 100
        const height = (item.y2 - item.y) * 100
        if (item.type === 'freehand') return <polyline key={item.id || 'draft'} points={(item.points || []).map((point) => `${point.x * 100},${point.y * 100}`).join(' ')} />
        if (item.type === 'length') return <g key={item.id || 'draft'}><line x1={`${x}%`} y1={`${y}%`} x2={`${item.x2 * 100}%`} y2={`${item.y2 * 100}%`} /><text className="measurement-label" x={`${(x + item.x2 * 100) / 2}%`} y={`${(y + item.y2 * 100) / 2 - 2}%`}>{metricFor(item, item.series || series)}</text></g>
        if (item.type === 'ellipse') return <g key={item.id || 'draft'}><ellipse cx={`${(item.x + item.x2) * 50}%`} cy={`${(item.y + item.y2) * 50}%`} rx={`${Math.abs(width) / 2}%`} ry={`${Math.abs(height) / 2}%`} /><text className="measurement-label" x={`${Math.min(x, item.x2 * 100) + 1}%`} y={`${Math.min(y, item.y2 * 100) - 2}%`}>{metricFor(item, item.series || series)}</text></g>
        if (item.type === 'annotation') return <g key={item.id || 'draft'}><line className="annotation-arrow" x1={`${x}%`} y1={`${y}%`} x2={`${item.x2 * 100}%`} y2={`${item.y2 * 100}%`} markerEnd="url(#annotation-arrow)" /><rect className="annotation-label-bg" x={`${item.x2 * 100 + 1}%`} y={`${item.y2 * 100 - 7}%`} width={`${Math.max(12, (item.text || '').length * 2.5)}%`} height="6%" rx="1" /><text x={`${item.x2 * 100 + 2}%`} y={`${item.y2 * 100 - 2.5}%`}>{item.text}</text></g>
        return <g key={item.id || 'draft'}><rect x={`${Math.min(x, item.x2 * 100)}%`} y={`${Math.min(y, item.y2 * 100)}%`} width={`${Math.abs(width)}%`} height={`${Math.abs(height)}%`} /><text className="measurement-label" x={`${Math.min(x, item.x2 * 100) + 1}%`} y={`${Math.min(y, item.y2 * 100) - 2}%`}>{metricFor(item, item.series || series)}</text></g>
      })}
    </svg>
  )
}

export default function FocusedViewer({ series, slices, currentIndex, onActiveSliceChange, contrast, brightness, inverted, geometryReady = false }) {
  const [layout, setLayout] = useState('1x1')
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false)
  const [layoutHover, setLayoutHover] = useState(null)
  const [activeViewport, setActiveViewport] = useState(0)
  const [indices, setIndices] = useState([])
  const [syncSlices, setSyncSlices] = useState(false)
  const [tool, setTool] = useState('pointer')
  const [toolMenuOpen, setToolMenuOpen] = useState(false)
  const [viewports, setViewports] = useState({})
  const [annotations, setAnnotations] = useState({})
  const [draft, setDraft] = useState(null)
  const [annotationEditor, setAnnotationEditor] = useState(null)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [loadedSliceKeys, setLoadedSliceKeys] = useState({})
  const stageRefs = useRef([])
  const dragRef = useRef(null)
  const initializedSeriesRef = useRef(null)
  const skipParentSyncRef = useRef(false)

  const { rows, columns, count } = layoutDimensions(layout)
  const total = slices.length
  const activeIndex = indices[activeViewport] ?? currentIndex ?? middleIndex(total)
  const activeView = viewports[activeViewport] || defaultViewport()
  const selectedTool = tools.find((item) => item.id === tool) || tools[0]
  const SelectedToolIcon = selectedTool.icon

  useEffect(() => {
    const newSeries = total > 0 && initializedSeriesRef.current !== series?.id
    if (total > 0) initializedSeriesRef.current = series?.id
    const startingIndex = newSeries ? 0 : currentIndex
    setIndices(viewportIndices(count, startingIndex, total))
    setActiveViewport(0)
    setDraft(null)
    setLoadedSliceKeys({})
    if (newSeries) {
      skipParentSyncRef.current = true
      onActiveSliceChange?.(0)
    }
  }, [series?.id, layout, total])

  useEffect(() => {
    if (!total || currentIndex === undefined || currentIndex === null) return
    if (skipParentSyncRef.current) {
      skipParentSyncRef.current = false
      return
    }
    setIndices((current) => {
      const next = current.length === count ? [...current] : viewportIndices(count, currentIndex, total)
      if (syncSlices) return next.map(() => clamp(currentIndex, 0, total - 1))
      next[activeViewport] = clamp(currentIndex, 0, total - 1)
      return next
    })
  }, [currentIndex, activeViewport, count, syncSlices, total])

  const updateViewport = (index, updater) => setViewports((current) => ({
    ...current,
    [index]: typeof updater === 'function' ? updater(current[index] || defaultViewport()) : updater,
  }))

  const changeZoom = (index, delta) => updateViewport(index, (current) => {
    const zoom = Math.max(1, current.zoom + delta)
    const fit = zoom === 1
    return { zoom, fit, pan: fit ? { x: 0, y: 0 } : current.pan }
  })

  const pointFromEvent = (index, event) => {
    const rect = stageRefs.current[index]?.querySelector('.image-stage')?.getBoundingClientRect()
    if (!rect) return { x: 0.5, y: 0.5 }
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    }
  }

  const handlePanStart = (index, event) => {
    const current = viewports[index] || defaultViewport()
    if (current.zoom <= 1 && current.fit) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = { index, startX: event.clientX, startY: event.clientY, originX: current.pan.x, originY: current.pan.y }
  }

  const handlePanMove = (event) => {
    if (!dragRef.current) return
    const { index } = dragRef.current
    updateViewport(index, (current) => ({
      ...current,
      pan: {
        x: dragRef.current.originX + event.clientX - dragRef.current.startX,
        y: dragRef.current.originY + event.clientY - dragRef.current.startY,
      },
    }))
  }

  const handlePointerUp = (event) => {
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setDraft(null)
  }

  const handleDrawStart = (index, event) => {
    const point = pointFromEvent(index, event)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDraft({ viewport: index, type: tool, ...point, x2: point.x, y2: point.y, points: tool === 'freehand' ? [point] : undefined })
  }

  const handleDrawMove = (index, event) => {
    if (!draft || draft.viewport !== index) return
    const point = pointFromEvent(index, event)
    setDraft((current) => {
      if (!current) return current
      if (current.type === 'freehand') return { ...current, points: [...current.points, point], x2: point.x, y2: point.y }
      return { ...current, x2: point.x, y2: point.y }
    })
  }

  const finishDrawing = (event) => {
    if (draft && Math.abs(draft.x2 - draft.x) + Math.abs(draft.y2 - draft.y) > 0.01) {
      const { viewport, ...annotation } = draft
      if (annotation.type === 'annotation') {
        setAnnotationEditor({ viewport, draft: annotation, text: '' })
      } else {
        setAnnotations((current) => ({ ...current, [viewport]: [...(current[viewport] || []), { ...annotation, series, metric: metricFor(annotation, series), sliceIndex: indices[viewport] ?? 0, id: crypto.randomUUID() }] }))
      }
    }
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (!annotationEditor) setDraft(null)
  }

  const selectViewport = (index) => {
    setActiveViewport(index)
    onActiveSliceChange?.(indices[index] ?? middleIndex(total))
  }

  const setSliceForViewport = (index, nextIndex) => {
    const next = clamp(nextIndex, 0, Math.max(total - 1, 0))
    setActiveViewport(index)
    setIndices((current) => current.map((value, viewportIndex) => syncSlices || viewportIndex === index ? next : value))
    onActiveSliceChange?.(next)
  }

  const handleWheel = (index, event) => {
    event.preventDefault()
    setSliceForViewport(index, (indices[index] ?? middleIndex(total)) + (event.deltaY > 0 ? 1 : -1))
  }

  const saveAnnotation = () => {
    if (!annotationEditor?.text.trim()) return
    const { viewport, draft: annotation, text } = annotationEditor
    setAnnotations((current) => ({ ...current, [viewport]: [...(current[viewport] || []), { ...annotation, text: text.trim(), series, sliceIndex: indices[viewport] ?? 0, id: crypto.randomUUID() }] }))
    setAnnotationEditor(null)
    setDraft(null)
  }

  const marksForViewport = (index) => {
    const sliceIndex = indices[index] ?? 0
    return (annotations[index] || []).filter((item) => item.sliceIndex === undefined || item.sliceIndex === sliceIndex)
  }

  const removeLastMark = () => {
    const sliceIndex = indices[activeViewport] ?? 0
    setAnnotations((current) => {
      const marks = current[activeViewport] || []
      const removeIndex = [...marks].map((item, index) => ({ item, index })).reverse().find(({ item }) => item.sliceIndex === undefined || item.sliceIndex === sliceIndex)?.index
      if (removeIndex === undefined) return current
      return { ...current, [activeViewport]: marks.filter((_, index) => index !== removeIndex) }
    })
  }

  const clearSliceMarks = () => {
    const sliceIndex = indices[activeViewport] ?? 0
    setAnnotations((current) => ({
      ...current,
      [activeViewport]: (current[activeViewport] || []).filter((item) => item.sliceIndex !== undefined && item.sliceIndex !== sliceIndex),
    }))
  }

  const chooseLayout = (value) => {
    setLayout(value)
    setLayoutMenuOpen(false)
    setLayoutHover(null)
  }

  const layoutPreview = layoutHover ? `${layoutHover.row + 1}x${layoutHover.column + 1}` : null

  const exportCapture = ({ format, size, includeAnnotations, includeMetadata }) => {
    const image = stageRefs.current[activeViewport]?.querySelector('img')
    if (!image) return
    const outputSize = size === 'native' ? Math.max(image.naturalWidth, image.naturalHeight, 512) : Number.parseInt(size, 10) || 1600
    const canvas = document.createElement('canvas')
    canvas.width = outputSize
    canvas.height = outputSize
    const context = canvas.getContext('2d')
    context.fillStyle = '#10202f'
    context.fillRect(0, 0, outputSize, outputSize)
    const scale = Math.min(outputSize / image.naturalWidth, outputSize / image.naturalHeight)
    const width = image.naturalWidth * scale
    const height = image.naturalHeight * scale
    context.drawImage(image, (outputSize - width) / 2, (outputSize - height) / 2, width, height)
    if (includeAnnotations) {
      const items = marksForViewport(activeViewport)
      context.strokeStyle = '#36a3ff'
      context.fillStyle = '#36a3ff'
      context.lineWidth = Math.max(2, outputSize / 500)
      items.forEach((item) => {
        const x = item.x * outputSize
        const y = item.y * outputSize
        const x2 = item.x2 === undefined ? x : item.x2 * outputSize
        const y2 = item.y2 === undefined ? y : item.y2 * outputSize
        if (item.type === 'length') { context.beginPath(); context.moveTo(x, y); context.lineTo(x2, y2); context.stroke(); context.fillText(item.metric || metricFor(item, series), (x + x2) / 2, (y + y2) / 2 - 8) }
        else if (item.type === 'ellipse') { context.ellipse((x + x2) / 2, (y + y2) / 2, Math.abs(x2 - x) / 2, Math.abs(y2 - y) / 2, 0, 0, Math.PI * 2); context.stroke(); context.fillText(item.metric || metricFor(item, series), Math.min(x, x2) + 8, Math.min(y, y2) - 8) }
        else if (item.type === 'freehand') { const points = item.points || []; if (points.length) { context.beginPath(); context.moveTo(points[0].x * outputSize, points[0].y * outputSize); points.slice(1).forEach((point) => context.lineTo(point.x * outputSize, point.y * outputSize)); context.stroke() } }
        else if (item.type === 'annotation') { context.beginPath(); context.moveTo(x, y); context.lineTo(x2, y2); context.stroke(); const angle = Math.atan2(y2 - y, x2 - x); context.beginPath(); context.moveTo(x2, y2); context.lineTo(x2 - 14 * Math.cos(angle - Math.PI / 6), y2 - 14 * Math.sin(angle - Math.PI / 6)); context.lineTo(x2 - 14 * Math.cos(angle + Math.PI / 6), y2 - 14 * Math.sin(angle + Math.PI / 6)); context.closePath(); context.fill(); context.fillText(item.text, x2 + 8, y2 - 8) }
        else { context.strokeRect(Math.min(x, x2), Math.min(y, y2), Math.abs(x2 - x), Math.abs(y2 - y)); context.fillText(item.metric || metricFor(item, series), Math.min(x, x2) + 8, Math.min(y, y2) - 8) }
      })
    }
    if (includeMetadata) {
      context.fillStyle = 'rgba(0, 0, 0, .65)'
      context.fillRect(0, outputSize - 42, outputSize, 42)
      context.fillStyle = '#fff'
      context.font = `${Math.max(14, outputSize / 80)}px Arial`
      context.fillText(`${series?.description || 'DICOM series'} · ${series?.plane || ''} · slice ${activeIndex + 1}/${total}`, 16, outputSize - 16)
    }
    const mime = format === 'jpg' ? 'image/jpeg' : 'image/png'
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `knee-review-${series?.plane || 'viewport'}-${activeIndex + 1}.${format}`
      link.click()
      URL.revokeObjectURL(url)
      setCaptureOpen(false)
    }, mime, format === 'jpg' ? 0.92 : undefined)
  }

  return (
    <>
      <div className="focused-tools">
        <div className="focused-tool-group layout-picker-wrap"><button className={`tool-button layout-trigger ${layoutMenuOpen ? 'selected-control' : ''}`} onClick={() => setLayoutMenuOpen((open) => !open)} aria-expanded={layoutMenuOpen}><Grid2X2 size={14} /> Layout: {layout.replace('x', ' × ')} ▾</button>{layoutMenuOpen && <div className="layout-picker-popover"><b>Layout</b><div className="layout-preset-options">{presetLayouts.map((value) => <button key={value} className={layout === value ? 'selected-control' : ''} onClick={() => chooseLayout(value)}>{value.replace('x', ' × ')}</button>)}</div><div className="layout-custom-heading"><span>Custom grid</span><strong>{layoutPreview || layout.replace('x', ' × ')}</strong></div><div className="layout-draw-grid" onMouseLeave={() => setLayoutHover(null)}>{Array.from({ length: 16 }, (_, cell) => { const row = Math.floor(cell / 4); const column = cell % 4; const value = `${row + 1}x${column + 1}`; const selected = layoutHover || { row: layoutDimensions(layout).rows - 1, column: layoutDimensions(layout).columns - 1 }; const preview = row <= selected.row && column <= selected.column; return <button key={value} className={preview ? 'grid-cell selected-control' : 'grid-cell'} onMouseEnter={() => setLayoutHover({ row, column })} onFocus={() => setLayoutHover({ row, column })} onClick={() => chooseLayout(value)} aria-label={`Use ${value} layout`} /> })}</div><small>Hover to preview, click to apply</small></div>}</div>
        <label className="tool-toggle"><input type="checkbox" checked={syncSlices} onChange={(event) => { const checked = event.target.checked; setSyncSlices(checked); if (checked) setIndices((current) => current.map(() => activeIndex)) }} /><Link2 size={14} /> Sync slices</label>
        <div className="focused-tool-group tool-select-wrap tool-picker-wrap"><span className="tool-label">Tool</span><div className="tool-picker"><button type="button" className={`tool-button tool-picker-trigger ${toolMenuOpen ? 'selected-control' : ''}`} onClick={() => setToolMenuOpen((open) => !open)} aria-expanded={toolMenuOpen}><SelectedToolIcon size={14} /> {selectedTool.label} ▾</button>{toolMenuOpen && <div className="tool-picker-popover">{tools.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={tool === id ? 'selected-control' : ''} onClick={() => { setTool(id); setToolMenuOpen(false) }}><Icon size={14} /><span>{label}</span></button>)}</div>}</div></div>
        <div className="focused-tool-group compact-zoom"><span className="tool-label">Zoom</span><button className="tool-button" aria-label="Focused zoom out" onClick={() => changeZoom(activeViewport, -0.25)} disabled={activeView.zoom === 1}><Minus size={14} /></button><span className="zoom-value">{Math.round(activeView.zoom * 100)}%</span><button className="tool-button" aria-label="Focused zoom in" onClick={() => changeZoom(activeViewport, 0.25)}><Plus size={14} /></button><button className="tool-button" onClick={() => updateViewport(activeViewport, defaultViewport())}>Reset</button></div>
        <button className="tool-button" disabled title="Requires mapped MPR geometry"><Crosshair size={14} /> Crosshair</button>
        <button className="tool-button" onClick={removeLastMark} disabled={!marksForViewport(activeViewport).length} title="Remove the last mark on this slice"><Undo2 size={14} /> Undo mark</button>
        <button className="tool-button" onClick={clearSliceMarks} disabled={!marksForViewport(activeViewport).length} title="Remove all marks on this slice"><Trash2 size={14} /> Clear slice marks</button>
        <button className="button small capture-button" onClick={() => setCaptureOpen(true)}><Camera size={14} /> Capture</button>
      </div>

      <div className={`focused-grid layout-${layout} ${count > 4 ? 'dense-layout' : ''}`} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, auto)` }}>
        {Array.from({ length: count }, (_, index) => {
          const slice = slices[indices[index] ?? middleIndex(total)]
          const sliceKey = slice?.image_url || slice?.id
          const sliceLoaded = Boolean(sliceKey && loadedSliceKeys[index] === sliceKey)
          const active = index === activeViewport
          const viewport = viewports[index] || defaultViewport()
          const interaction = tool === 'pointer' ? {
            onWheel: (event) => handleWheel(index, event),
            onPointerDown: (event) => handlePanStart(index, event),
            onPointerMove: handlePanMove,
            onPointerUp: handlePointerUp,
            onPointerCancel: handlePointerUp,
          } : {
            onPointerDown: (event) => handleDrawStart(index, event),
            onPointerMove: (event) => handleDrawMove(index, event),
            onPointerUp: finishDrawing,
            onPointerCancel: handlePointerUp,
          }
          return (
            <div key={`${series?.id || 'empty'}-${index}`} ref={(element) => { stageRefs.current[index] = element }} className={`focused-viewport ${active ? 'active' : ''}`} onClick={() => selectViewport(index)}>
              <ImageCard
                title={`${series?.plane || 'View'} · ${String.fromCharCode(65 + index)}`}
                series={series}
                active={active}
                interactive={active && tool === 'pointer'}
                forcePointerInteraction={active}
                slice={slice}
                slicePosition={`${(indices[index] ?? 0) + 1} / ${total}`}
                focused
                showOpen={false}
                showTitle={false}
                resetLabel="Reset"
                overlay={<AnnotationOverlay annotations={marksForViewport(index)} draft={draft?.viewport === index ? draft : null} series={series} />}
                sliceRail={<SliceRail title={`viewport ${String.fromCharCode(65 + index)}`} total={total} value={indices[index] ?? 0} disabled={!slice || !sliceLoaded} onChange={(next) => setSliceForViewport(index, next)} />}
                {...viewport}
                contrast={contrast}
                brightness={brightness}
                inverted={inverted}
                onActivate={() => selectViewport(index)}
                onResetView={() => updateViewport(index, defaultViewport())}
                onWheel={interaction.onWheel}
                onPointerDown={interaction.onPointerDown}
                onPointerMove={interaction.onPointerMove}
                onPointerUp={interaction.onPointerUp}
                onPointerCancel={interaction.onPointerCancel}
                onImageLoad={() => setLoadedSliceKeys((current) => ({ ...current, [index]: sliceKey }))}
              />
              <div className="viewport-controls" onClick={(event) => event.stopPropagation()}>
                <span className="viewport-index">{String.fromCharCode(65 + index)} · Slice {(indices[index] ?? 0) + 1}/{total}</span>
                <div className="viewport-zoom-controls"><button className="viewport-step" aria-label={`Zoom out viewport ${String.fromCharCode(65 + index)}`} onClick={() => { selectViewport(index); changeZoom(index, -0.25) }} disabled={viewport.zoom === 1}>−</button><span>{Math.round(viewport.zoom * 100)}%</span><button className="viewport-step" aria-label={`Zoom in viewport ${String.fromCharCode(65 + index)}`} onClick={() => { selectViewport(index); changeZoom(index, 0.25) }}>+</button><button className="viewport-reset" onClick={() => { selectViewport(index); updateViewport(index, defaultViewport()) }}>Reset</button></div>
              </div>
              {annotationEditor?.viewport === index && <form className="annotation-editor" style={{ left: `${annotationEditor.draft.x2 * 100}%`, top: `${annotationEditor.draft.y2 * 100}%` }} onSubmit={(event) => { event.preventDefault(); saveAnnotation() }} onClick={(event) => event.stopPropagation()}><label>Annotation note<input autoFocus value={annotationEditor.text} onChange={(event) => setAnnotationEditor((current) => ({ ...current, text: event.target.value }))} placeholder="Describe this finding" /></label><div><button type="button" onClick={() => { setAnnotationEditor(null); setDraft(null) }}>Cancel</button><button type="submit" className="primary-action">Add note</button></div></form>}
            </div>
          )
        })}
      </div>

      <div className="focused-hint">{tool === 'pointer' ? 'Pointer active. Wheel changes slices: scroll down for the next slice, up for the previous. Use the vertical rail to scrub; zoom with the controls and drag after zooming to pan.' : `${tools.find((item) => item.id === tool)?.label} tool active. Select a viewport and draw on its current slice.`} Use Undo mark or Clear slice marks if you make a mistake. {geometryReady ? 'Measurements use available geometry.' : 'Measurements show px until PixelSpacing is validated; physical crosshair needs MPR geometry.'}</div>
      <CaptureModal open={captureOpen} series={series} slicePosition={`${activeIndex + 1} / ${total}`} annotationCount={marksForViewport(activeViewport).length} onClose={() => setCaptureOpen(false)} onExport={exportCapture} />
    </>
  )
}

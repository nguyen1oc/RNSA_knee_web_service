import { useEffect, useRef, useState } from 'react'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { activateTool, core, createTools, imageId, initializeImaging, sliceAnnotations, stackEngine, tools, uniqueId } from '../imaging/runtime'
import { createCaptureBlob, downloadCapture } from '../imaging/capture'
import { orientationLabels } from '../imaging/orientation'
import OrientationLabels from './OrientationLabels'

export default function NativeViewport({ series, slices = [], index = 0, active, title, tool = 'pointer', onActivate, onIndex, onOpen, apiRef }) {
  const elementRef = useRef(null)
  const runtime = useRef(null)
  const latest = useRef(null)
  latest.current = { active, tool, onIndex, onActivate, index }
  const [status, setStatus] = useState('Loading DICOM…')
  const [view, setView] = useState({ zoom: 1, width: 0, center: 0 })
  const [note, setNote] = useState(null)
  const noteRef = useRef(null)
  const [invert, setInvert] = useState(false)
  const [labels, setLabels] = useState([])
  const idsKey = slices.map((slice) => slice.dicom_url).join('|')

  useEffect(() => {
    if (!series || !slices.length) return
    let disposed = false
    let cleanup = () => {}
    const element = elementRef.current
    setStatus('Loading DICOM…')
    ;(async () => {
      await initializeImaging()
      if (disposed) return
      const engine = stackEngine()
      const id = uniqueId('stack')
      engine.enableElement({ viewportId: id, element, type: core.Enums.ViewportType.STACK, defaultOptions: { background: [0, 0, 0] } })
      const viewport = engine.getViewport(id)
      const group = createTools(id, id, engine.id, (text, done) => {
        noteRef.current = done
        setNote(text)
      })
      const state = { viewport, group, busy: true, disposed: false, index: Math.min(latest.current.index, slices.length - 1) }
      runtime.current = state
      const updateInfo = () => {
        if (disposed) return
        const properties = viewport.getProperties()
        const voi = properties.voiRange
        const zoom = viewport.getZoom()
        // Fit is the lower bound, including zoom performed with the right mouse button.
        if (zoom < 1 - 0.001) viewport.setZoom(1)
        setView({ zoom: Math.max(1, zoom), width: voi ? voi.upper - voi.lower : 0, center: voi ? (voi.upper + voi.lower) / 2 : 0 })
        setInvert(Boolean(properties.invert))
        if (series.geometry?.image_orientation_patient && series.geometry?.position_range) setLabels(orientationLabels(viewport, element))
      }
      const requestSlice = async (requested, queueLatest = false) => {
        if (state.disposed) return
        if (state.busy) { if (queueLatest) state.pending = requested; return }
        const target = Math.max(0, Math.min(slices.length - 1, requested))
        if (target === state.index) return
        state.busy = true
        setStatus('Loading slice…')
        try {
          await viewport.setImageIdIndex(target)
          if (disposed) return
          viewport.render()
          await new Promise((resolve) => requestAnimationFrame(resolve))
          state.index = target
          latest.current.onIndex?.(target)
          setStatus('')
        } catch (error) { if (!disposed) setStatus(`DICOM load failed: ${error.message}`) }
        finally {
          state.busy = false
          if (state.pending != null && !disposed) {
            const pending = state.pending
            state.pending = null
            requestSlice(pending)
          }
        }
      }
      state.requestSlice = requestSlice
      let lastWheel = 0
      const wheel = (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (!latest.current.active || state.busy) return
        if (event.ctrlKey) {
          viewport.setZoom(Math.max(1, viewport.getZoom() * (event.deltaY < 0 ? 1.1 : 1 / 1.1)))
          viewport.render()
        } else if (performance.now() - lastWheel > 120 && event.deltaY !== 0) {
          lastWheel = performance.now()
          requestSlice(state.index + Math.sign(event.deltaY))
        }
      }
      const contextMenu = (event) => event.preventDefault()
      element.parentElement.addEventListener('wheel', wheel, { passive: false, capture: true })
      element.addEventListener('contextmenu', contextMenu)
      element.addEventListener(core.Enums.Events.IMAGE_RENDERED, updateInfo)
      const observer = new ResizeObserver(() => { if (!state.busy && !disposed) engine.resize(true, true) })
      observer.observe(element)
      state.reset = () => { viewport.resetCamera(); viewport.resetProperties(); viewport.render() }
      state.zoom = (factor) => { viewport.setZoom(Math.max(1, viewport.getZoom() * factor)); viewport.render() }
      const captureLabel = () => `${series.plane} · slice ${state.index + 1}/${slices.length} · Research preview`
      state.previewCapture = (options) => createCaptureBlob(viewport, element, options, captureLabel())
      state.downloadCapture = (blob, format) => downloadCapture(blob, format)
      state.annotationCount = () => sliceAnnotations(viewport).length
      state.clear = () => {
        sliceAnnotations(viewport).forEach((item) => tools.annotation.state.removeAnnotation(item.annotationUID))
        tools.utilities.triggerAnnotationRenderForViewportIds([id])
      }
      apiRef?.(state)
      cleanup = () => {
        state.disposed = true
        noteRef.current?.('')
        noteRef.current = null
        observer.disconnect()
        element.parentElement.removeEventListener('wheel', wheel, true)
        element.removeEventListener('contextmenu', contextMenu)
        element.removeEventListener(core.Enums.Events.IMAGE_RENDERED, updateInfo)
        tools.ToolGroupManager.destroyToolGroup(id)
        engine.disableElement(id)
        runtime.current = null
        apiRef?.(null)
      }
      await viewport.setStack(slices.map((slice) => imageId(slice.dicom_url)), state.index)
      if (disposed) return
      viewport.resetCamera()
      activateTool(group, latest.current.tool, latest.current.active)
      viewport.render()
      state.busy = false
      updateInfo()
      setStatus('')
      if (latest.current.index !== state.index) requestSlice(latest.current.index)
    })().catch((error) => { if (!disposed) setStatus(`DICOM load failed: ${error.message}`) })
    return () => { disposed = true; cleanup() }
  }, [series?.id, idsKey])

  useEffect(() => { if (runtime.current) activateTool(runtime.current.group, tool, active) }, [tool, active])
  useEffect(() => { runtime.current?.requestSlice(index, true) }, [index])

  if (!series) return <article className="viewer-card native-empty"><h3>{title}</h3><p>No acquisition available for this direction.</p></article>
  return <article className={`viewer-card native-card ${active ? 'native-active' : ''}`} onPointerDownCapture={() => onActivate?.()}>
    <div className="native-card-head"><strong>{title || series.plane}</strong><span>{index + 1} / {slices.length}</span>
      <button title="Zoom out" aria-label={`Zoom out ${title}`} disabled={!active} onClick={() => runtime.current?.zoom(1 / 1.25)}><Minus size={14} /></button>
      <span>{Math.round(view.zoom * 100)}%</span><button title="Zoom in" aria-label={`Zoom in ${title}`} disabled={!active} onClick={() => runtime.current?.zoom(1.25)}><Plus size={14} /></button>
      <button onClick={() => runtime.current?.reset()}><RotateCcw size={12} /> Reset</button>
      {onOpen && <button onClick={(event) => { event.stopPropagation(); onOpen() }}>Open</button>}
    </div>
    <div className="native-stage">
      <div ref={elementRef} className="dicom-element" aria-label={`${title} DICOM viewport`} />
      <OrientationLabels labels={labels} />
      {status && <div className="native-status" role="status">{status}</div>}
      <input className="native-rail" aria-label={`${title} slice`} type="range" min="0" max={Math.max(0, slices.length - 1)} value={index} disabled={!active || Boolean(status)}
        onChange={(event) => runtime.current?.requestSlice(Number(event.target.value))} />
      {note !== null && <form className="native-note" onSubmit={(event) => { event.preventDefault(); noteRef.current?.(note); noteRef.current = null; setNote(null) }}>
        <label>Annotation<input autoFocus value={note} maxLength={240} onChange={(event) => setNote(event.target.value)} /></label>
        <button type="submit">Save</button><button type="button" onClick={() => { noteRef.current?.(''); noteRef.current = null; setNote(null) }}>Cancel</button>
      </form>}
    </div>
    <div className="native-voi"><span>W {view.width.toFixed(0)} / L {view.center.toFixed(0)}</span><button onClick={() => {
      const viewport = runtime.current?.viewport
      viewport?.setProperties({ invert: !invert }); viewport?.render()
    }}>{invert ? 'Uninvert' : 'Invert'}</button><span>{series.spacing?.length === 2 ? 'DICOM spacing' : 'Uncalibrated — verify units'}</span></div>
    <div className="card-foot" title={series.description}><span>{series.description}</span><span>{active ? 'Active' : 'Click to select'}</span></div>
  </article>
}

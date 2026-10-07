import { useEffect, useRef, useState } from 'react'
import { Crosshair, Contrast, MousePointer2, RotateCcw } from 'lucide-react'
import { core, tools, uniqueId } from '../imaging/runtime'
import { loadVolume } from '../imaging/volume'
import { orientationLabels } from '../imaging/orientation'
import OrientationLabels from './OrientationLabels'

const planes = ['AXIAL', 'SAGITTAL', 'CORONAL']
export default function MprViewer({ series }) {
  const elements = useRef([])
  const runtime = useRef(null)
  const [status, setStatus] = useState('')
  const [ready, setReady] = useState(false)
  const [anisotropic, setAnisotropic] = useState(false)
  const [mode, setMode] = useState('crosshair')
  const [active, setActive] = useState(0)
  const [steps, setSteps] = useState([])
  const [labels, setLabels] = useState([])
  const activeRef = useRef(0)
  activeRef.current = active
  useEffect(() => {
    if (!series) return
    const controller = new AbortController()
    let dispose = () => {}
    setReady(false)
    setStatus('Checking DICOM geometry…')
    ;(async () => {
      const result = await loadVolume(series.id, controller.signal, (done, total) => setStatus(`Loading volume: ${done} / ${total}`))
      if (controller.signal.aborted) { core.cache.removeVolumeLoadObject(result.id); return }
      const id = uniqueId('mpr-engine')
      const engine = new core.RenderingEngine(id)
      const group = tools.ToolGroupManager.createToolGroup(id)
      group.addTool(tools.CrosshairsTool.toolName, {
        getReferenceLineColor: (viewportId) => ['#6fc4ff', '#ffd166', '#8bdeae'][planes.indexOf(viewportId.split('-').at(-1))] || '#6fc4ff',
        getReferenceLineControllable: () => true,
        getReferenceLineDraggableRotatable: () => true,
        getReferenceLineSlabThicknessControlsOn: () => false,
      })
      group.addTool(tools.PanTool.toolName)
      group.addTool(tools.WindowLevelTool.toolName)
      group.addTool(tools.ZoomTool.toolName, { zoomToCenter: true, minZoomScale: 1, maxZoomScale: Number.MAX_VALUE })
      const ids = planes.map((plane) => `${id}-${plane}`)
      engine.setViewports(planes.map((plane, index) => ({ viewportId: ids[index], element: elements.current[index],
        type: core.Enums.ViewportType.ORTHOGRAPHIC, defaultOptions: { orientation: core.Enums.OrientationAxis[plane], background: [0, 0, 0] } })))
      ids.forEach((viewportId) => group.addViewport(viewportId, id))
      const state = { engine, group, ids, volumeId: result.id }
      runtime.current = state
      const cleanups = []
      dispose = () => {
        cleanups.forEach((cleanup) => cleanup())
        tools.ToolGroupManager.destroyToolGroup(id)
        engine.destroy()
        result.volume.cancelLoading()
        core.cache.removeVolumeLoadObject(result.id)
        runtime.current = null
      }
      await core.setVolumesForViewports(engine, [{ volumeId: result.id }], ids)
      if (controller.signal.aborted) return
      ids.forEach((viewportId, index) => {
        const viewport = engine.getViewport(viewportId)
        const element = elements.current[index]
        let last = 0
        const wheel = (event) => {
          event.preventDefault(); event.stopPropagation()
          if (activeRef.current !== index || performance.now() - last < 120) return
          last = performance.now()
          if (event.ctrlKey) { viewport.setZoom(Math.max(1, viewport.getZoom() * (event.deltaY < 0 ? 1.1 : 1 / 1.1))); viewport.render() }
          else core.utilities.scroll(viewport, { delta: Math.sign(event.deltaY), volumeId: result.id })
        }
        const update = () => {
          const info = core.utilities.getVolumeViewportScrollInfo(viewport, result.id)
          if (viewport.getZoom() < 0.999) { viewport.setZoom(1); viewport.render() }
          setSteps((previous) => { const next = [...previous]; next[index] = info; return next })
          setLabels((previous) => { const next = [...previous]; next[index] = orientationLabels(viewport, element); return next })
        }
        const preventMenu = (event) => event.preventDefault()
        element.parentElement.addEventListener('wheel', wheel, { passive: false, capture: true })
        element.addEventListener('contextmenu', preventMenu)
        element.addEventListener(core.Enums.Events.IMAGE_RENDERED, update)
        const observer = new ResizeObserver(() => engine.resize(true, true))
        observer.observe(element)
        cleanups.push(() => { observer.disconnect(); element.parentElement.removeEventListener('wheel', wheel, true); element.removeEventListener('contextmenu', preventMenu); element.removeEventListener(core.Enums.Events.IMAGE_RENDERED, update) })
      })
      setAnisotropic(result.geometry.anisotropic)
      setMode('crosshair')
      group.setToolActive(tools.CrosshairsTool.toolName, { bindings: [{ mouseButton: 1 }] })
      group.setToolActive(tools.ZoomTool.toolName, { bindings: [{ mouseButton: 2 }] })
      engine.render()
      setReady(true)
      setStatus('')
    })().catch((error) => { if (!controller.signal.aborted) { dispose(); dispose = () => {}; setStatus(`MPR unavailable: ${error.message}`) } })
    return () => { controller.abort(); dispose() }
  }, [series?.id])

  const selectMode = (value) => {
    setMode(value)
    const group = runtime.current?.group
    if (!group) return
    ;[tools.CrosshairsTool, tools.PanTool, tools.WindowLevelTool].forEach((Tool) => group.setToolPassive(Tool.toolName, { removeAllBindings: true }))
    const Tool = value === 'crosshair' ? tools.CrosshairsTool : value === 'window' ? tools.WindowLevelTool : tools.PanTool
    group.setToolActive(Tool.toolName, { bindings: [{ mouseButton: 1 }] })
  }
  return <section className="mpr-workspace">
    <div className="native-tools">{[['crosshair', 'Crosshair', Crosshair], ['window', 'Window / Level', Contrast], ['pan', 'Pan', MousePointer2]].map(([value, label, Icon]) =>
      <button key={value} disabled={!ready} className={`tool-button ${mode === value ? 'selected-control' : ''}`} onClick={() => selectMode(value)}><Icon size={15} /> {label}</button>)}
      <button className="tool-button" disabled={!ready} onClick={() => runtime.current.ids.forEach((id) => { const vp = runtime.current.engine.getViewport(id); vp.resetCamera(); vp.resetProperties(); vp.render() })}><RotateCcw size={15} /> Reset</button>
    </div>
    <p className="native-help">MPR reconstructs three planes from <strong>{series?.description}</strong>, not from different acquisitions. Click a crosshair to move the intersection in the other two planes. Right-drag zooms; wheel scrolls the selected plane.</p>
    {anisotropic && ready && <p className="native-warning">Thick / anisotropic slices: reconstructed planes have lower through-plane detail. Interpolation does not recover missing anatomy.</p>}
    {status && <p className="native-warning" role="status">{status} Original acquisition views remain available.</p>}
    <div className="mpr-grid">{planes.map((plane, index) => <article key={plane} className={`viewer-card native-card ${active === index ? 'native-active' : ''}`} onPointerDownCapture={() => setActive(index)}>
      <div className="native-card-head"><strong>{plane} · MPR</strong><span>{ready && steps[index] ? `${steps[index].currentStepIndex + 1} / ${steps[index].numScrollSteps + 1}` : '—'}</span></div>
      <div className="native-stage"><div ref={(element) => { elements.current[index] = element }} className="dicom-element" aria-label={`${plane} MPR viewport`} /><OrientationLabels labels={labels[index]} /></div>
    </article>)}</div>
    <p className="native-help">Research viewer — not validated for clinical diagnosis. Patient-specific 3D volume rendering is not part of this phase.</p>
  </section>
}

import { useEffect, useRef, useState } from 'react'
import { Box, Crosshair, Contrast, Minus, MousePointer2, Plus, RotateCcw } from 'lucide-react'
import { Quaternion, Vector3 } from 'three'
import { core, tools, uniqueId } from '../imaging/runtime'
import { loadVolume } from '../imaging/volume'
import { orientationLabels } from '../imaging/orientation'
import { projectMprSlicePlanes } from '../imaging/slicePlanes'
import OrientationLabels from './OrientationLabels'
import VolumeOrientationGizmo from './VolumeOrientationGizmo'

const planes = ['AXIAL', 'SAGITTAL', 'CORONAL']
const planeColors = ['#ff7777', '#f4d35e', '#6fd69b']
const volumePresets = [
  { value: 'MR-Default', label: 'Standard MR' },
  { value: 'MR-Angio', label: 'Angio-style (experimental)' },
]
const layouts = [
  { value: '3d-four-up', label: '3D four-up' },
  { value: '3d-primary', label: '3D primary' },
  { value: '3d-main', label: '3D main' },
]
export default function MprViewer({ series }) {
  const elements = useRef([])
  const runtime = useRef(null)
  const [status, setStatus] = useState('')
  const [ready, setReady] = useState(false)
  const [anisotropic, setAnisotropic] = useState(false)
  const [mode, setMode] = useState('crosshair')
  const [active, setActive] = useState(3)
  const [steps, setSteps] = useState([])
  const [labels, setLabels] = useState([])
  const [slicePlanes, setSlicePlanes] = useState([])
  const [selectedPlane, setSelectedPlane] = useState(0)
  const [volumePreset, setVolumePreset] = useState('MR-Default')
  const [volumeZoom, setVolumeZoom] = useState(1)
  const [projection, setProjection] = useState('composite')
  const [layout, setLayout] = useState('3d-four-up')
  const activeRef = useRef(0)
  activeRef.current = active
  const selectedPlaneRef = useRef(0)
  selectedPlaneRef.current = selectedPlane
  useEffect(() => {
    if (!series) return
    const controller = new AbortController()
    let dispose = () => {}
    setReady(false)
    setSlicePlanes([])
    setStatus('Checking DICOM geometry…')
    ;(async () => {
      const result = await loadVolume(series.id, controller.signal, (done, total) => setStatus(`Loading volume: ${done} / ${total}`))
      if (controller.signal.aborted) { core.cache.removeVolumeLoadObject(result.id); return }
      const id = uniqueId('mpr-engine')
      const engine = new core.RenderingEngine(id)
      const group = tools.ToolGroupManager.createToolGroup(id)
      const rotateGroupId = `${id}-3d-rotate`
      const rotateGroup = tools.ToolGroupManager.createToolGroup(rotateGroupId)
      group.addTool(tools.CrosshairsTool.toolName, {
        getReferenceLineColor: (viewportId) => ['#6fc4ff', '#ffd166', '#8bdeae'][planes.indexOf(viewportId.split('-').at(-1))] || '#6fc4ff',
        getReferenceLineControllable: () => true,
        getReferenceLineDraggableRotatable: () => true,
        getReferenceLineSlabThicknessControlsOn: () => false,
      })
      group.addTool(tools.PanTool.toolName)
      group.addTool(tools.WindowLevelTool.toolName)
      group.addTool(tools.ZoomTool.toolName, { zoomToCenter: true, minZoomScale: 1, maxZoomScale: Number.MAX_VALUE })
      rotateGroup.addTool(tools.TrackballRotateTool.toolName)
      rotateGroup.addTool(tools.ZoomTool.toolName, { zoomToCenter: true, minZoomScale: 0.01, maxZoomScale: Number.MAX_VALUE })
      const ids = [...planes.map((plane) => `${id}-${plane}`), `${id}-VOLUME-3D`]
      engine.setViewports([
        ...planes.map((plane, index) => ({ viewportId: ids[index], element: elements.current[index],
          type: core.Enums.ViewportType.ORTHOGRAPHIC, defaultOptions: { orientation: core.Enums.OrientationAxis[plane], background: [0, 0, 0] } })),
        { viewportId: ids[3], element: elements.current[3], type: core.Enums.ViewportType.VOLUME_3D,
          defaultOptions: { background: [0, 0, 0] } },
      ])
      planes.forEach((_, index) => group.addViewport(ids[index], id))
      rotateGroup.addViewport(ids[3], id)
      const state = { engine, group, rotateGroup, ids, volumeId: result.id, volume: result.volume }
      runtime.current = state
      const cleanups = []
      let projectionFrame = 0
      const updateSlicePlanes = () => {
        cancelAnimationFrame(projectionFrame)
        projectionFrame = requestAnimationFrame(() => {
          if (controller.signal.aborted) return
          const volumeViewport = engine.getViewport(ids[3])
          setSlicePlanes(projectMprSlicePlanes(result.volume, engine,
            planes.map((label, index) => ({ id: ids[index], label, color: planeColors[index] })), volumeViewport))
        })
      }
      dispose = () => {
        cleanups.forEach((cleanup) => cleanup())
        cancelAnimationFrame(projectionFrame)
        tools.ToolGroupManager.destroyToolGroup(id)
        tools.ToolGroupManager.destroyToolGroup(rotateGroupId)
        engine.destroy()
        result.volume.cancelLoading()
        core.cache.removeVolumeLoadObject(result.id)
        runtime.current = null
      }
      await core.setVolumesForViewports(engine, [{ volumeId: result.id }], ids)
      if (controller.signal.aborted) return
      const volumeViewport = engine.getViewport(ids[3])
      volumeViewport.setProperties({ preset: volumePreset })
      volumeViewport.setBlendMode(core.Enums.BlendModes.COMPOSITE)
      volumeViewport.resetCamera()
      ids.forEach((viewportId, index) => {
        const viewport = engine.getViewport(viewportId)
        const element = elements.current[index]
        let last = 0
        const wheel = (event) => {
          event.preventDefault(); event.stopPropagation()
          const isVolume = index === 3 && activeRef.current === 3
          if ((activeRef.current !== index && !isVolume) || performance.now() - last < 120) return
          last = performance.now()
          if (event.ctrlKey && !isVolume) { viewport.setZoom(Math.max(1, viewport.getZoom() * (event.deltaY < 0 ? 1.1 : 1 / 1.1))); viewport.render() }
          else {
            const targetIndex = isVolume ? selectedPlaneRef.current : index
            core.utilities.scroll(engine.getViewport(ids[targetIndex]), { delta: Math.sign(event.deltaY), volumeId: result.id })
          }
        }
        const update = () => {
          const info = core.utilities.getVolumeViewportScrollInfo(viewport, result.id)
          if (index === 3) setVolumeZoom(viewport.getZoom())
          setSteps((previous) => { const next = [...previous]; next[index] = info; return next })
          setLabels((previous) => { const next = [...previous]; next[index] = orientationLabels(viewport, element); return next })
        }
        const preventMenu = (event) => event.preventDefault()
        element.parentElement.addEventListener('wheel', wheel, { passive: false, capture: true })
        element.addEventListener('contextmenu', preventMenu)
        element.addEventListener(core.Enums.Events.IMAGE_RENDERED, update)
        if (index === 3) element.addEventListener(core.Enums.Events.CAMERA_MODIFIED, update)
        if (index === 3) element.addEventListener(core.Enums.Events.CAMERA_MODIFIED, updateSlicePlanes)
        else element.addEventListener(core.Enums.Events.IMAGE_RENDERED, updateSlicePlanes)
        const observer = new ResizeObserver(() => engine.resize(true, true))
        observer.observe(element)
        cleanups.push(() => {
          observer.disconnect()
          element.parentElement.removeEventListener('wheel', wheel, true)
          element.removeEventListener('contextmenu', preventMenu)
          element.removeEventListener(core.Enums.Events.IMAGE_RENDERED, update)
          if (index === 3) element.removeEventListener(core.Enums.Events.CAMERA_MODIFIED, update)
          element.removeEventListener(index === 3 ? core.Enums.Events.CAMERA_MODIFIED : core.Enums.Events.IMAGE_RENDERED, updateSlicePlanes)
        })
      })
      setAnisotropic(result.geometry.anisotropic)
      setMode('crosshair')
      group.setToolActive(tools.CrosshairsTool.toolName, { bindings: [{ mouseButton: 1 }] })
      group.setToolActive(tools.ZoomTool.toolName, { bindings: [{ mouseButton: 2 }] })
      rotateGroup.setToolActive(tools.TrackballRotateTool.toolName, { bindings: [{ mouseButton: 1 }] })
      rotateGroup.setToolActive(tools.ZoomTool.toolName, { bindings: [{ mouseButton: 2 }] })
      engine.render()
      updateSlicePlanes()
      setReady(true)
      setStatus('')
    })().catch((error) => { if (!controller.signal.aborted) { dispose(); dispose = () => {}; setStatus(`MPR unavailable: ${error.message}`) } })
    return () => { controller.abort(); dispose() }
  }, [series?.id])

  useEffect(() => {
    const viewport = runtime.current?.engine.getViewport(runtime.current.ids[3])
    if (!viewport || !ready) return
    try { viewport.setProperties({ preset: volumePreset }); viewport.render() }
    catch (error) { setStatus(`3D preset unavailable: ${error.message}`) }
  }, [volumePreset, ready])

  useEffect(() => {
    const viewport = runtime.current?.engine.getViewport(runtime.current.ids[3])
    if (!viewport || !ready) return
    const blendMode = projection === 'mip'
      ? core.Enums.BlendModes.MAXIMUM_INTENSITY_BLEND
      : core.Enums.BlendModes.COMPOSITE
    viewport.setBlendMode(blendMode)
    viewport.render()
  }, [projection, ready])

  const selectMode = (value) => {
    setMode(value)
    const group = runtime.current?.group
    if (!group) return
    ;[tools.CrosshairsTool, tools.PanTool, tools.WindowLevelTool].forEach((Tool) => group.setToolPassive(Tool.toolName, { removeAllBindings: true }))
    const Tool = value === 'crosshair' ? tools.CrosshairsTool : value === 'window' ? tools.WindowLevelTool : tools.PanTool
    group.setToolActive(Tool.toolName, { bindings: [{ mouseButton: 1 }] })
  }
  const rotateVolumeCamera = (axis, angle) => {
    const viewport = runtime.current?.engine.getViewport(runtime.current.ids[3])
    const camera = viewport?.getCamera()
    if (!viewport || !camera?.focalPoint || !camera.position || !camera.viewUp) return
    const focal = new Vector3(...camera.focalPoint)
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(...axis).normalize(), angle)
    const position = new Vector3(...camera.position).sub(focal).applyQuaternion(rotation).add(focal)
    const viewUp = new Vector3(...camera.viewUp).applyQuaternion(rotation).normalize()
    const viewPlaneNormal = focal.clone().sub(position).normalize()
    viewport.setCamera({ focalPoint: focal.toArray(), position: position.toArray(), viewUp: viewUp.toArray(), viewPlaneNormal: viewPlaneNormal.toArray() })
    viewport.render()
  }
  const zoomVolume = (factor) => {
    const viewport = runtime.current?.engine.getViewport(runtime.current.ids[3])
    if (!viewport) return
    const nextZoom = Math.min(Number.MAX_VALUE, Math.max(0.01, viewport.getZoom() * factor))
    viewport.setZoom(nextZoom)
    viewport.render()
    setVolumeZoom(nextZoom)
  }
  const planePointerDown = (event, index) => {
    event.preventDefault()
    event.stopPropagation()
    const overlay = event.currentTarget
    setSelectedPlane(index)
    setActive(3)
    overlay.setPointerCapture(event.pointerId)
    const planeViewport = runtime.current?.engine.getViewport(runtime.current.ids[index])
    const volumeViewport = runtime.current?.engine.getViewport(runtime.current.ids[3])
    if (!planeViewport || !volumeViewport) return
    const info = core.utilities.getVolumeViewportScrollInfo(planeViewport, runtime.current.volumeId)
    const { spacingInNormalDirection: spacing, camera: sliceCamera } = info.sliceRangeInfo
    const normal = sliceCamera.viewPlaneNormal
    const focus = camera.focalPoint
    const origin = volumeViewport.worldToCanvas(focus)
    const next = volumeViewport.worldToCanvas(focus.map((value, axis) => value + normal[axis] * spacing))
    const stepVector = [next[0] - origin[0], next[1] - origin[1]]
    const edgeOn = Math.hypot(...stepVector) < 2
    const dragAxis = edgeOn ? 1 : Math.abs(stepVector[0]) >= Math.abs(stepVector[1]) ? 0 : 1
    const projectedStep = Math.abs(stepVector[dragAxis])
    const pixelsPerSlice = Math.max(projectedStep, 8)
    const dragSign = edgeOn ? -1 : Math.sign(stepVector[dragAxis]) || 1
    const initial = { x: event.clientX, y: event.clientY }
    let accumulated = 0
    let movedSteps = 0
    const onMove = (moveEvent) => {
      const pointerDelta = dragAxis === 0 ? moveEvent.clientX - initial.x : moveEvent.clientY - initial.y
      accumulated = pointerDelta * dragSign / pixelsPerSlice
      const target = Math.trunc(accumulated)
      const difference = target - movedSteps
      if (!difference) return
      movedSteps = target
      core.utilities.scroll(planeViewport, { delta: difference, volumeId: runtime.current.volumeId })
    }
    const onUp = () => {
      overlay.removeEventListener('pointermove', onMove)
      overlay.removeEventListener('pointerup', onUp)
      overlay.removeEventListener('pointercancel', onUp)
    }
    overlay.addEventListener('pointermove', onMove)
    overlay.addEventListener('pointerup', onUp)
    overlay.addEventListener('pointercancel', onUp)
  }
  const resetViewports = () => runtime.current.ids.forEach((id, index) => {
    const viewport = runtime.current.engine.getViewport(id)
    viewport.resetCamera()
    if (index < 3) viewport.resetProperties()
    else {
      viewport.setProperties({ preset: volumePreset })
      viewport.setBlendMode(projection === 'mip' ? core.Enums.BlendModes.MAXIMUM_INTENSITY_BLEND : core.Enums.BlendModes.COMPOSITE)
    }
    viewport.render()
  })

  return <section className="mpr-workspace" aria-label="MRI overview with synchronized MPR">
    <div className="overview-layout-bar">
      <span className="tool-label">Overview layout</span>
      {layouts.map(({ value, label }) => <button key={value} className={`tool-button ${layout === value ? 'selected-control' : ''}`} aria-pressed={layout === value} onClick={() => setLayout(value)}>{label}</button>)}
      <span className="overview-series-label"><Box size={14} /> Source: {series?.description || 'Select a series'} · feeds all 3 planes</span>
    </div>
    <div className="native-tools">{[['crosshair', 'Crosshair', Crosshair], ['window', 'Window / Level', Contrast], ['pan', 'Pan', MousePointer2]].map(([value, label, Icon]) =>
      <button key={value} disabled={!ready} className={`tool-button ${mode === value ? 'selected-control' : ''}`} onClick={() => selectMode(value)}><Icon size={15} /> {label}</button>)}
      <label className="mpr-volume-preset"><Box size={15} /><span>Volume appearance</span><select aria-label="MRI volume appearance" disabled={!ready} value={volumePreset} onChange={(event) => setVolumePreset(event.target.value)}>{volumePresets.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="mpr-volume-preset"><span>Projection</span><select aria-label="Volume projection mode" disabled={!ready} value={projection} onChange={(event) => setProjection(event.target.value)}><option value="composite">Composite</option><option value="mip">Maximum intensity (MIP)</option></select></label>
      <button className="tool-button" disabled={!ready} onClick={resetViewports}><RotateCcw size={15} /> Reset</button>
    </div>
    <p className="native-help">The selected <strong>MPR source</strong> supplies one volume for the linked axial, coronal and sagittal planes; changing it reloads all four views together. The direction tabs remain the original acquired stacks. Colored planes track the current slice positions. Drag a plane to move through its slices. Drag the black MRI Volume viewport background to rotate freely; drag a colored orbit ring to rotate around its axis. Camera controls affect only the volume, while Crosshair links all three MPR views.</p>
    {anisotropic && ready && <p className="native-warning">Thick / anisotropic slices: reconstructed planes have lower through-plane detail. Interpolation does not recover missing anatomy.</p>}
    {status && <p className="native-warning" role="status">{status} Original acquisition views remain available.</p>}
    <div className={`mpr-grid layout-${layout}`}>{planes.map((plane, index) => <article key={plane} className={`viewer-card native-card mpr-plane mpr-plane-${plane.toLowerCase()} ${active === index ? 'native-active' : ''}`} onPointerDownCapture={() => setActive(index)}>
      <div className="native-card-head"><strong>{plane} · MPR</strong><span>{ready && steps[index] ? `${steps[index].currentStepIndex + 1} / ${steps[index].numScrollSteps + 1}` : '—'}</span></div>
      <div className="native-stage"><div ref={(element) => { elements.current[index] = element }} className="dicom-element" aria-label={`${plane} MPR viewport`} /><OrientationLabels labels={labels[index]} /></div>
    </article>)}<article className={`viewer-card native-card mpr-volume-card ${active === 3 ? 'native-active' : ''}`} onPointerDownCapture={() => setActive(3)}>
      <div className="native-card-head"><strong>3D · MRI volume</strong><span className="mpr-volume-status">{ready ? `${planes[selectedPlane]} plane` : '—'}</span>
        <div className="mpr-volume-zoom-controls" role="group" aria-label="MRI volume zoom">
          <button aria-label="Zoom MRI volume out" title="Zoom out" disabled={!ready || volumeZoom <= 0.0101} onClick={() => zoomVolume(1 / 1.25)}><Minus size={14} /></button>
          <output aria-live="polite">{Math.round(volumeZoom * 100)}%</output>
          <button aria-label="Zoom MRI volume in" title="Zoom in" disabled={!ready} onClick={() => zoomVolume(1.25)}><Plus size={14} /></button>
        </div>
      </div>
      <div className="native-stage"><div ref={(element) => { elements.current[3] = element }} className="dicom-element" aria-label="Rotatable 3D MRI volume" />
        <svg className="mpr-slice-plane-overlay" viewBox={`0 0 ${slicePlanes[0]?.viewWidth || 1} ${slicePlanes[0]?.viewHeight || 1}`} preserveAspectRatio="none" aria-label="Current MPR slice planes" role="img">
          {slicePlanes.map((plane, index) => <polygon key={plane.id} points={plane.points.map((point) => point.join(',')).join(' ')} fill={plane.color} fillOpacity={selectedPlane === index ? 0.2 : 0.08} stroke={plane.color} strokeWidth={selectedPlane === index ? 2 : 1} vectorEffect="non-scaling-stroke" className="mpr-slice-plane" role="button" aria-label={`Select ${plane.label} slice plane`} onClick={() => { setSelectedPlane(index); setActive(3) }} onPointerDown={(event) => planePointerDown(event, index)} />)}
        </svg>
        <div className="mpr-plane-legend">{planes.map((plane, index) => <button key={plane} className={selectedPlane === index ? 'selected-control' : ''} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setSelectedPlane(index); setActive(3) }}><i style={{ backgroundColor: planeColors[index] }} />{plane}</button>)}</div>
        <VolumeOrientationGizmo onRotate={rotateVolumeCamera} />
      </div>
      <div className="mpr-volume-foot">Patient-specific voxel volume · {volumePresets.find(({ value }) => value === volumePreset)?.label} · {projection === 'mip' ? 'Maximum-intensity projection' : 'Composite projection'}</div>
    </article></div>
    <p className="native-help">Research viewer — exploratory intensity-based rendering, not a segmentation or diagnosis. FS/fluid appearance comes from the MRI acquisition. “Angio-style” changes display mapping only; MIP is the separate maximum-intensity projection mode.</p>
  </section>
}

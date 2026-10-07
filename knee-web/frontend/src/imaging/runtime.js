import * as core from '@cornerstonejs/core'
import * as tools from '@cornerstonejs/tools'
import { init as loaderInit } from '@cornerstonejs/dicom-image-loader'

export { core, tools }
export const toolClasses = {
  pointer: tools.PanTool,
  window: tools.WindowLevelTool,
  length: tools.LengthTool,
  rectangle: tools.RectangleROITool,
  ellipse: tools.EllipticalROITool,
  freehand: tools.PlanarFreehandROITool,
  annotation: tools.ArrowAnnotateTool,
  erase: tools.EraserTool,
}
let initialization
let engine
let sequence = 0
export const uniqueId = (prefix) => `${prefix}-${++sequence}`
export const imageId = (url) => `wadouri:${new URL(url, window.location.origin).href}`

export function initializeImaging() {
  initialization ??= (async () => {
    await core.init()
    loaderInit({ maxWebWorkers: 2 })
    await tools.init()
    core.cache.setMaxCacheSize(512 * 1024 * 1024)
    new Set([...Object.values(toolClasses), tools.ZoomTool, tools.CrosshairsTool, tools.TrackballRotateTool]).forEach((Tool) => tools.addTool(Tool))
    const styles = tools.annotation.config.style.getDefaultToolStyles()
    tools.annotation.config.style.setDefaultToolStyles({ ...styles, global: {
      ...styles.global, textBoxFontFamily: 'Arial, sans-serif', textBoxFontSize: '14px',
      color: 'rgb(255, 221, 87)', lineWidth: '1.5', textBoxBackground: 'rgba(0, 0, 0, 0.7)',
    } })
  })()
  return initialization
}

export function stackEngine() {
  engine ??= new core.RenderingEngine('native-stacks')
  return engine
}

export function createTools(id, viewportId, engineId, editNote) {
  const group = tools.ToolGroupManager.createToolGroup(id)
  Object.values(toolClasses).forEach((Tool) => {
    group.addTool(Tool.toolName, Tool === tools.ArrowAnnotateTool ? {
      getTextCallback: (done) => editNote('', done),
      changeTextCallback: (annotation, _event, done) => editNote(annotation.data.text || '', done),
    } : {})
  })
  group.addTool(tools.ZoomTool.toolName, { zoomToCenter: true, minZoomScale: 1, maxZoomScale: Number.MAX_VALUE })
  group.addViewport(viewportId, engineId)
  return group
}

export function activateTool(group, name, active) {
  Object.values(toolClasses).forEach((Tool) => group.setToolPassive(Tool.toolName, { removeAllBindings: true }))
  group.setToolPassive(tools.ZoomTool.toolName, { removeAllBindings: true })
  if (!active) return
  group.setToolActive(toolClasses[name]?.toolName || tools.PanTool.toolName, { bindings: [{ mouseButton: 1 }] })
  if (name !== 'pointer') group.setToolActive(tools.PanTool.toolName, { bindings: [{ mouseButton: 4 }] })
  group.setToolActive(tools.ZoomTool.toolName, { bindings: [{ mouseButton: 2 }] })
}

export function sliceAnnotations(viewport) {
  return tools.annotation.state.getAllAnnotations().filter((item) => item.metadata.referencedImageId === viewport.getCurrentImageId())
}

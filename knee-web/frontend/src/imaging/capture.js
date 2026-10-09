// Capture the rendered viewport, not the original pixel buffer: W/L, pan and zoom are retained.
export async function createCaptureBlob(viewport, element, options, label) {
  viewport.render()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const source = viewport.getCanvas()
  if (!source?.width || !source?.height) throw new Error('The selected viewport is not ready for capture.')
  const size = Number(options.size)
  if (![512, 256, 128].includes(size)) throw new Error('Choose a supported square export size.')
  const metadataHeight = options.includeMetadata ? Math.max(20, Math.round(size * 0.08)) : 0
  const imageAreaHeight = size - metadataHeight
  const scale = Math.min(size / source.width, imageAreaHeight / source.height)
  const imageWidth = Math.round(source.width * scale)
  const imageHeight = Math.round(source.height * scale)
  const imageX = Math.round((size - imageWidth) / 2)
  const imageY = Math.round((imageAreaHeight - imageHeight) / 2)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  context.fillStyle = '#000'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(source, imageX, imageY, imageWidth, imageHeight)
  const svg = element.querySelector('svg')
  if (options.includeAnnotations && svg) {
    const copy = svg.cloneNode(true)
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    copy.setAttribute('width', element.clientWidth)
    copy.setAttribute('height', element.clientHeight)
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }))
    try {
      const overlay = new Image()
      overlay.src = url
      await overlay.decode()
      context.drawImage(overlay, imageX, imageY, imageWidth, imageHeight)
    } finally { URL.revokeObjectURL(url) }
  }
  if (options.includeMetadata) {
    context.fillStyle = '#fff'
    context.font = `${Math.max(8, Math.round(size / 36))}px Arial`
    context.fillText(label, 8, size - Math.max(6, Math.round(metadataHeight * 0.3)), size - 16)
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, options.format === 'jpg' ? 'image/jpeg' : 'image/png', 0.95))
  if (!blob) throw new Error('Capture failed. Try a smaller export size.')
  return blob
}

export function downloadCapture(blob, format) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `knee-viewport.${format}`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

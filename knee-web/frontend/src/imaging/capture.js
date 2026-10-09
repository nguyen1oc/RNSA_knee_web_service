async function captureCanvas(viewport, element, options, label) {
  viewport.render()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const source = viewport.getCanvas()
  const size = options.size === 'native' ? Math.max(source.width, source.height) : Number(options.size)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  context.fillStyle = '#000'
  context.fillRect(0, 0, size, size)

  const metadataHeight = options.includeMetadata ? Math.max(16, Math.round(size * 0.07)) : 0
  const availableHeight = size - metadataHeight
  const scale = Math.min(size / source.width, availableHeight / source.height)
  const drawWidth = source.width * scale
  const drawHeight = source.height * scale
  const drawX = (size - drawWidth) / 2
  const drawY = (availableHeight - drawHeight) / 2
  context.drawImage(source, drawX, drawY, drawWidth, drawHeight)

  const svg = element.querySelector('svg')
  if (options.includeAnnotations && svg) {
    const copy = svg.cloneNode(true)
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    copy.setAttribute('width', element.clientWidth)
    copy.setAttribute('height', element.clientHeight)
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.textContent = '.annotation-overlay line,.annotation-overlay rect,.annotation-overlay ellipse{fill:none;stroke:#41a9f2;stroke-width:1.4}.annotation-overlay polyline{fill:none;stroke:#41a9f2;stroke-width:1.4}.annotation-overlay circle{fill:#41a9f2;stroke:#fff;stroke-width:.4}.annotation-overlay text{fill:#fff;font:600 4px Arial;paint-order:stroke;stroke:#10202f;stroke-width:1px}.annotation-overlay marker path{fill:#41a9f2}'
    copy.insertBefore(style, copy.firstChild)
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }))
    try {
      const overlay = new Image()
      overlay.src = url
      await overlay.decode()
      context.drawImage(overlay, drawX, drawY, drawWidth, drawHeight)
    } finally { URL.revokeObjectURL(url) }
  }

  if (options.includeMetadata) {
    context.fillStyle = '#101820'
    context.fillRect(0, size - metadataHeight, size, metadataHeight)
    context.fillStyle = '#fff'
    context.font = `${Math.max(8, Math.round(size * 0.028))}px Arial`
    context.textBaseline = 'middle'
    const compactLabel = size < 128 ? label.split('·').slice(0, 2).join('·') : label
    context.fillText(compactLabel, Math.max(4, size * 0.025), size - metadataHeight / 2, size - 8)
  }

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, options.format === 'jpg' ? 'image/jpeg' : 'image/png', 0.95))
  if (!blob) throw new Error('Capture failed. Try another export format or size.')
  return blob
}

export function previewViewport(viewport, element, options, label) {
  return captureCanvas(viewport, element, options, label)
}

export async function captureViewport(viewport, element, options, label) {
  const blob = await captureCanvas(viewport, element, options, label)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `knee-viewport-${options.size}x${options.size}.${options.format}`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

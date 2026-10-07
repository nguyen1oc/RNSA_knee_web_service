// Capture the rendered viewport, not the original pixel buffer: W/L, pan and zoom are retained.
export async function captureViewport(viewport, element, options, label) {
  viewport.render()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const source = viewport.getCanvas()
  const width = options.size === 'native' ? source.width : options.size === 'custom' ? 1600 : Number(options.size)
  const height = Math.round(width * source.height / source.width)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height + (options.includeMetadata ? 40 : 0)
  const context = canvas.getContext('2d')
  context.fillStyle = '#000'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(source, 0, 0, width, height)
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
      context.drawImage(overlay, 0, 0, width, height)
    } finally { URL.revokeObjectURL(url) }
  }
  if (options.includeMetadata) {
    context.fillStyle = '#fff'
    context.font = '14px Arial'
    context.fillText(label, 12, height + 25, width - 24)
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, options.format === 'jpg' ? 'image/jpeg' : 'image/png', 0.95))
  if (!blob) throw new Error('Capture failed. Try a smaller export size.')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `knee-viewport.${options.format}`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

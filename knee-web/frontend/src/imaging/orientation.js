// Derive screen-edge labels from patient LPS coordinates, not acquisition names.
export function orientationLabels(viewport, element) {
  const width = element.clientWidth
  const height = element.clientHeight
  const center = viewport.canvasToWorld([width / 2, height / 2])
  const points = [[width / 2, 0], [width, height / 2], [width / 2, height], [0, height / 2]]
  return points.map((point) => {
    const world = viewport.canvasToWorld(point)
    const vector = world.map((value, axis) => value - center[axis])
    const magnitude = Math.hypot(...vector)
    if (!Number.isFinite(magnitude) || magnitude === 0) return ''
    return vector.map((value, axis) => ({ value, axis }))
      .filter(({ value }) => Math.abs(value) / magnitude > 0.2)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .map(({ value, axis }) => (value < 0 ? ['R', 'A', 'I'] : ['L', 'P', 'S'])[axis]).join('')
  })
}

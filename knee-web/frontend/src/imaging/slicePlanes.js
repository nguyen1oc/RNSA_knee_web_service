const edges = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
]

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const normalize = (v) => {
  const length = Math.hypot(...v)
  return length > 1e-8 ? v.map((value) => value / length) : null
}

function intersectVolumeBounds(bounds, point, normal) {
  const [xmin, xmax, ymin, ymax, zmin, zmax] = bounds
  const corners = [
    [xmin, ymin, zmin], [xmax, ymin, zmin], [xmax, ymax, zmin], [xmin, ymax, zmin],
    [xmin, ymin, zmax], [xmax, ymin, zmax], [xmax, ymax, zmax], [xmin, ymax, zmax],
  ]
  const distance = corners.map((corner) => dot(subtract(corner, point), normal))
  const intersections = []
  const addUnique = (candidate) => {
    if (!intersections.some((existing) => Math.hypot(...subtract(existing, candidate)) < 0.01)) intersections.push(candidate)
  }
  edges.forEach(([a, b]) => {
    const da = distance[a]
    const db = distance[b]
    if (Math.abs(da) < 1e-6) addUnique(corners[a])
    if (Math.abs(db) < 1e-6) addUnique(corners[b])
    if (da * db < 0) {
      const ratio = da / (da - db)
      addUnique(corners[a].map((value, axis) => value + (corners[b][axis] - value) * ratio))
    }
  })
  if (intersections.length < 3) return []

  const center = intersections.reduce((sum, value) => sum.map((part, axis) => part + value[axis] / intersections.length), [0, 0, 0])
  const viewUp = Math.abs(normal[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1]
  const u = normalize(cross(normal, viewUp)) || [1, 0, 0]
  const v = normalize(cross(normal, u)) || [0, 1, 0]
  intersections.sort((a, b) => {
    const va = subtract(a, center)
    const vb = subtract(b, center)
    return Math.atan2(dot(va, v), dot(va, u)) - Math.atan2(dot(vb, v), dot(vb, u))
  })
  return intersections
}

export function projectMprSlicePlanes(volume, engine, planeViewports, volumeViewport) {
  if (!volume?.imageData || !volumeViewport) return []
  const bounds = volume.imageData.getBounds()
  const width = volumeViewport.element.clientWidth
  const height = volumeViewport.element.clientHeight
  if (!bounds || !width || !height) return []
  return planeViewports.map(({ id, label, color }) => {
    const viewport = engine.getViewport(id)
    const camera = viewport?.getCamera()
    const normal = camera && normalize(camera.viewPlaneNormal)
    if (!camera?.focalPoint || !normal) return null
    const worldPoints = intersectVolumeBounds(bounds, camera.focalPoint, normal)
    const points = worldPoints.map((point) => volumeViewport.worldToCanvas(point))
      .filter((point) => point?.every(Number.isFinite))
    if (points.length < 3) return null
    return { id, label, color, points, viewWidth: width, viewHeight: height }
  }).filter(Boolean)
}

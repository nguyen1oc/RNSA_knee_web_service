import { useRef } from 'react'

const orbitRings = [
  { id: 'horizontal', label: 'Horizontal orbit · rotate left / right', axis: [0, 1, 0], color: '#f4d35e', rx: 28, ry: 10, rotation: -32, arrowAngle: 5.1 },
  { id: 'vertical', label: 'Vertical orbit · rotate up / down', axis: [1, 0, 0], color: '#ff7777', rx: 11, ry: 28, rotation: -32, arrowAngle: 5.1 },
  { id: 'diagonal', label: 'Diagonal orbit · rotate obliquely', axis: [0, 0, 1], color: '#6fd69b', rx: 23, ry: 16, rotation: 48, arrowAngle: 5.1 },
]

function orbitPath(rx, ry) {
  const start = 0.35
  const end = 5.1
  const startX = 42 + rx * Math.cos(start)
  const startY = 42 + ry * Math.sin(start)
  const endX = 42 + rx * Math.cos(end)
  const endY = 42 + ry * Math.sin(end)
  return `M ${startX} ${startY} A ${rx} ${ry} 0 1 1 ${endX} ${endY}`
}

function pointerAngle(event, svg) {
  const bounds = svg.getBoundingClientRect()
  return Math.atan2(event.clientY - (bounds.top + bounds.height / 2), event.clientX - (bounds.left + bounds.width / 2))
}

export default function VolumeOrientationGizmo({ onRotate }) {
  const drag = useRef(null)

  const startDrag = (event, ring) => {
    event.preventDefault()
    event.stopPropagation()
    const svg = event.currentTarget.ownerSVGElement
    svg.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, ring, svg, angle: pointerAngle(event, svg) }
  }

  const moveDrag = (event) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const angle = pointerAngle(event, active.svg)
    let delta = angle - active.angle
    if (delta > Math.PI) delta -= Math.PI * 2
    if (delta < -Math.PI) delta += Math.PI * 2
    active.angle = angle
    if (Math.abs(delta) > 0.001) onRotate(active.ring.axis, delta)
  }

  const finishDrag = (event) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null
  }

  return <div className="mpr-orientation-gizmo" role="group" aria-label="MRI volume orbit rotation controls">
    <svg viewBox="0 0 84 84" role="group" aria-label="Three orbit paths for horizontal, vertical, and diagonal MRI volume rotation" onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
      <circle className="mpr-orbit-pivot" cx="42" cy="42" r="1.6" />
      {orbitRings.map((ring) => <g key={ring.id} className={`mpr-orbit-ring mpr-orbit-${ring.id}`} role="button" tabIndex="0" aria-label={`Drag to ${ring.label.toLowerCase()}`} onPointerDown={(event) => startDrag(event, ring)} onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onRotate(ring.axis, Math.PI / 12)
        }
        }}>
        <g transform={`rotate(${ring.rotation} 42 42)`}>
          <path className="mpr-orbit-hit" d={orbitPath(ring.rx, ring.ry)} />
          <path className="mpr-orbit-stroke" d={orbitPath(ring.rx, ring.ry)} stroke={ring.color} />
          <path
            className="mpr-orbit-direction"
            d="M -2.7 -2.4 L 1.4 0 L -2.7 2.4"
            transform={`translate(${42 + ring.rx * Math.cos(ring.arrowAngle)} ${42 + ring.ry * Math.sin(ring.arrowAngle)}) rotate(${Math.atan2(ring.ry * Math.cos(ring.arrowAngle), -ring.rx * Math.sin(ring.arrowAngle)) * 180 / Math.PI})`}
            stroke={ring.color}
          />
        </g>
        <title>{`Orbit path: drag to ${ring.label}. This is a rotation guide, not an image slice.`}</title>
      </g>)}
    </svg>
  </div>
}

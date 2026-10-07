import { useRef } from 'react'

const orbitRings = [
  { id: 'axial', label: 'Axial · rotate left / right', axis: [0, 0, 1], color: '#ff7777', rx: 28, ry: 11, rotation: -32 },
  { id: 'sagittal', label: 'Sagittal · rotate up / down', axis: [1, 0, 0], color: '#f4d35e', rx: 12, ry: 28, rotation: -32 },
  { id: 'coronal', label: 'Coronal · oblique rotation', axis: [0, 1, 0], color: '#6fd69b', rx: 24, ry: 17, rotation: 48 },
]

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
    <svg viewBox="0 0 84 84" role="group" aria-label="Drag an orbit ring to rotate the MRI volume" onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
      <circle cx="42" cy="42" r="2" fill="#dbe5ed" />
      {orbitRings.map((ring) => <g key={ring.id} className={`mpr-orbit-ring mpr-orbit-${ring.id}`} role="button" tabIndex="0" aria-label={`Drag to ${ring.label.toLowerCase()}`} onPointerDown={(event) => startDrag(event, ring)} onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onRotate(ring.axis, Math.PI / 12)
        }
      }}>
        <ellipse className="mpr-orbit-hit" cx="42" cy="42" rx={ring.rx} ry={ring.ry} transform={`rotate(${ring.rotation} 42 42)`} />
        <ellipse className="mpr-orbit-stroke" cx="42" cy="42" rx={ring.rx} ry={ring.ry} transform={`rotate(${ring.rotation} 42 42)`} stroke={ring.color} />
        <title>{`Drag ring to ${ring.label}`}</title>
      </g>)}
    </svg>
  </div>
}

import { useEffect, useRef } from 'react'

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

export default function SliceRail({ title, total, value, onChange, disabled = false, className = '' }) {
  const wheelState = useRef({ direction: 0, at: 0 })
  const valueRef = useRef(value)
  const targetRef = useRef(value)
  const animationRef = useRef(null)
  const disabledRef = useRef(disabled)

  useEffect(() => {
    disabledRef.current = disabled
    valueRef.current = value
    if (disabled) {
      targetRef.current = value
      if (animationRef.current !== null) window.clearTimeout(animationRef.current)
      animationRef.current = null
    } else if (animationRef.current === null) targetRef.current = value
  }, [value])

  useEffect(() => {
    disabledRef.current = disabled
    if (disabled) {
      targetRef.current = valueRef.current
      if (animationRef.current !== null) window.clearTimeout(animationRef.current)
      animationRef.current = null
    }
  }, [disabled])

  useEffect(() => () => {
    if (animationRef.current !== null) window.clearTimeout(animationRef.current)
    document.documentElement.classList.remove('slice-rail-dragging')
    document.body.classList.remove('slice-rail-dragging')
  }, [])

  if (!total) return null

  const stopEvent = (event) => {
    event.preventDefault()
    event.stopPropagation()
  }

  const lockPageScroll = () => {
    document.documentElement.classList.add('slice-rail-dragging')
    document.body.classList.add('slice-rail-dragging')
  }

  const unlockPageScroll = () => {
    document.documentElement.classList.remove('slice-rail-dragging')
    document.body.classList.remove('slice-rail-dragging')
  }

  const stepWithWheel = (event) => {
    stopEvent(event)
    if (disabled || !event.deltaY) return
    const direction = event.deltaY > 0 ? 1 : -1
    const now = performance.now()
    if (direction === wheelState.current.direction && now - wheelState.current.at < 70) return
    wheelState.current = { direction, at: now }
    requestValue(targetRef.current + direction)
  }

  const animateToTarget = () => {
    if (disabledRef.current) {
      targetRef.current = valueRef.current
      animationRef.current = null
      return
    }
    if (valueRef.current === targetRef.current) {
      animationRef.current = null
      return
    }
    const next = valueRef.current + Math.sign(targetRef.current - valueRef.current)
    valueRef.current = next
    onChange(next)
    animationRef.current = window.setTimeout(animateToTarget, 12)
  }

  const requestValue = (nextValue) => {
    if (disabled) return
    targetRef.current = clamp(nextValue, 0, Math.max(total - 1, 0))
    if (animationRef.current === null) animateToTarget()
  }

  const stepWithKeyboard = (event) => {
    if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) return
    stopEvent(event)
  }

  return (
    <div
      className={`slice-rail ${className}`}
      onPointerDown={(event) => { event.stopPropagation(); lockPageScroll() }}
      onPointerUp={unlockPageScroll}
      onPointerCancel={unlockPageScroll}
      onLostPointerCapture={unlockPageScroll}
      onClick={(event) => event.stopPropagation()}
      onWheel={stepWithWheel}
      onScroll={(event) => event.preventDefault()}
    >
      <span>1</span>
      <input
        type="range"
        min="0"
        max={Math.max(total - 1, 0)}
        step="1"
        value={value}
        disabled={disabled}
        onChange={(event) => requestValue(Number(event.target.value))}
        onWheel={(event) => {
          event.stopPropagation()
          stepWithWheel(event)
        }}
        onKeyDown={stepWithKeyboard}
        aria-label={`Slice rail for ${title}`}
      />
      <span>{total}</span>
    </div>
  )
}

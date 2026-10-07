import { useState } from 'react'
import { Grid2X2 } from 'lucide-react'

export default function LayoutPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState([0, 0])
  const choose = (rows, columns) => { onChange([rows, columns]); setOpen(false) }
  return <div className="native-dropdown">
    <button className="tool-button" aria-expanded={open} onClick={() => setOpen(!open)}><Grid2X2 size={16} /> Layout {value.join(' × ')} ▾</button>
    {open && <div className="native-menu native-layout-menu">
      <div><button onClick={() => choose(1, 1)}>1 × 1</button><button onClick={() => choose(2, 2)}>2 × 2</button><span>Custom: {hover.join(' × ')}</span></div>
      <div className="native-layout-cells">{Array.from({ length: 16 }, (_, index) => {
        const row = Math.floor(index / 4) + 1
        const column = index % 4 + 1
        return <button key={index} aria-label={`${row} rows ${column} columns`} className={row <= hover[0] && column <= hover[1] ? 'chosen' : ''}
          onMouseEnter={() => setHover([row, column])} onFocus={() => setHover([row, column])} onClick={() => choose(row, column)} />
      })}</div>
    </div>}
  </div>
}

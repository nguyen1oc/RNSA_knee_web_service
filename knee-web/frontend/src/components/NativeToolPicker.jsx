import { Circle, Contrast, Eraser, MousePointer2, Pencil, Ruler, Square, Type } from 'lucide-react'
import { useState } from 'react'

const choices = [
  ['pointer', 'Pointer / pan', MousePointer2], ['window', 'Window / Level', Contrast],
  ['length', 'Length', Ruler], ['rectangle', 'Rectangle ROI', Square], ['ellipse', 'Ellipse ROI', Circle],
  ['freehand', 'Freehand ROI', Pencil], ['annotation', 'Arrow + note', Type], ['erase', 'Eraser', Eraser],
]
export default function NativeToolPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [, label, Icon] = choices.find(([id]) => id === value) || choices[0]
  return <div className="native-dropdown">
    <button className="tool-button" aria-expanded={open} onClick={() => setOpen(!open)}><Icon size={16} /> {label} ▾</button>
    {open && <div className="native-menu">{choices.map(([id, name, Symbol]) => <button key={id} onClick={() => { onChange(id); setOpen(false) }}><Symbol size={16} /> {name}</button>)}</div>}
  </div>
}

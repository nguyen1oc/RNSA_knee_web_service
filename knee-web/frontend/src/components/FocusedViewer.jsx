import { useEffect, useRef, useState } from 'react'
import { Camera, Trash2 } from 'lucide-react'
import NativeViewport from './NativeViewport'
import NativeToolPicker from './NativeToolPicker'
import LayoutPicker from './LayoutPicker'
import CaptureModal from './CaptureModal'

export default function FocusedViewer({ series, slices, currentIndex, onActiveSliceChange }) {
  const [layout, setLayout] = useState([1, 1])
  const [active, setActive] = useState(0)
  const [indices, setIndices] = useState({})
  const [tool, setTool] = useState('pointer')
  const [capture, setCapture] = useState(false)
  const [error, setError] = useState('')
  const viewports = useRef({})
  const total = slices.length
  const indexFor = (cell) => Math.min(indices[cell] ?? cell, Math.max(0, total - 1))
  useEffect(() => { setIndices({}); setActive(0) }, [series?.id])
  useEffect(() => {
    if (currentIndex != null) setIndices((value) => ({ ...value, [active]: currentIndex }))
  }, [currentIndex])
  const choose = (cell) => { setActive(cell); onActiveSliceChange(indexFor(cell)) }
  return <>
    <div className="native-tools">
      <LayoutPicker value={layout} onChange={(value) => { setLayout(value); setActive(0); setIndices({}); onActiveSliceChange(0) }} />
      <NativeToolPicker value={tool} onChange={setTool} />
      <button className="tool-button" onClick={() => viewports.current[active]?.clear()}><Trash2 size={15} /> Clear slice marks</button>
      <button className="tool-button" onClick={() => setCapture(true)}><Camera size={15} /> Capture</button>
      <span>Wheel: slices · Ctrl+wheel / right-drag: zoom · Pointer: pan</span>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className={'native-focus-grid ' + (layout[0] === 1 && layout[1] === 1 ? 'native-single' : '')} style={{ gridTemplateColumns: 'repeat(' + layout[1] + ', minmax(0, 1fr))' }}>
      {Array.from({ length: layout[0] * layout[1] }, (_, cell) => <NativeViewport key={series?.id + '-' + cell}
        series={series} slices={slices} title={(series?.plane || 'Series') + ' · ' + (cell + 1)} active={active === cell} tool={tool}
        index={indexFor(cell)} onActivate={() => choose(cell)} apiRef={(value) => { viewports.current[cell] = value }}
        onIndex={(index) => { setIndices((value) => ({ ...value, [cell]: index })); if (active === cell) onActiveSliceChange(index) }} />)}
    </div>
    <p className="native-help">Measurements and notes stay in this browser session only. Eraser removes one mark; double-click an arrow to edit its note. Verify calibration before interpreting measurements.</p>
    <CaptureModal open={capture} series={series} slicePosition={indexFor(active) + 1} annotationCount={viewports.current[active]?.annotationCount() || 0}
      onClose={() => setCapture(false)} onExport={async (options) => {
        try { await viewports.current[active]?.capture(options); setCapture(false) }
        catch (exception) { setError(exception.message) }
      }} />
  </>
}

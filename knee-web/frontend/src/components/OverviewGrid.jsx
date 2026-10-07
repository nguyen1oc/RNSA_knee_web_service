import { useState } from 'react'
import NativeViewport from './NativeViewport'
import NativeToolPicker from './NativeToolPicker'
import LocatorCard from './LocatorCard'

export default function OverviewGrid({ planeSeries, activeSeries, currentIndex, overviewSliceIndices, onOverviewSliceChange, seriesSliceMap, selectSeries, activateSeries, studyGeometry }) {
  const [layout, setLayout] = useState('3d-four-up')
  const [tool, setTool] = useState('pointer')
  return <>
    <div className="overview-layout-bar"><span className="tool-label">Overview layout</span>
      {[['3d-four-up', '3D four-up'], ['3d-primary', '3D primary'], ['3d-main', '3D main']].map(([value, label]) =>
        <button key={value} className={'tool-button ' + (layout === value ? 'selected-control' : '')} onClick={() => setLayout(value)}>{label}</button>)}
      <NativeToolPicker value={tool} onChange={setTool} />
    </div>
    <div className={'viewer-grid overview-grid overview-layout-' + layout}>
      <LocatorCard activeSeries={activeSeries} studyGeometry={studyGeometry} />
      {[['SAG', 'Sagittal'], ['COR', 'Coronal'], ['AX', 'Axial']].map(([plane, title]) => {
        const series = planeSeries[plane]
        const active = activeSeries?.id === series?.id
        const stack = seriesSliceMap[series?.id] || []
        const index = active ? currentIndex : overviewSliceIndices[series?.id] ?? Math.floor(Math.max(0, stack.length - 1) / 2)
        return <NativeViewport key={series?.id || plane} title={title} series={series} slices={stack} index={index} active={active} tool={tool}
          onIndex={(value) => onOverviewSliceChange(series.id, value)} onActivate={() => activateSeries(series)} onOpen={series ? () => selectSeries(series) : undefined} />
      })}
    </div>
    <p className="native-help">Original acquisitions (not synchronized). Click a card to select; Open enters its direction tab. Wheel changes slices only in the selected card. Use MPR for linked crosshairs.</p>
  </>
}

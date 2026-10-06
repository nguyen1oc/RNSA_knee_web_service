import { useEffect, useState } from 'react'
import ImageCard from './ImageCard'
import LocatorCard from './LocatorCard'
import SliceRail from './SliceRail'

function OverviewImage({ title, series, previewItems = [], activeSeries, currentSlice, slices, currentIndex, overviewSliceIndices, onOverviewSliceChange, getViewport, contrast, brightness, inverted, selectSeries, activateSeries, resetView, seriesInteractionProps }) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const active = series?.id === activeSeries?.id
  const stack = active ? slices : previewItems
  const total = stack.length
  const defaultIndex = Math.floor(Math.max(total - 1, 0) / 2)
  const selectedIndex = active ? currentIndex : (overviewSliceIndices?.[series?.id] ?? defaultIndex)
  const slice = active ? currentSlice : stack[Math.min(selectedIndex, Math.max(total - 1, 0))]
  const slicePosition = total ? `${selectedIndex + 1} / ${total}` : '—'
  const changeSlice = (index) => onOverviewSliceChange?.(series?.id, index)

  useEffect(() => {
    setImageLoaded(false)
  }, [slice?.image_url])

  return (
    <ImageCard
      title={title}
      series={series}
      active={active}
      interactive={active}
      forcePointerInteraction={active}
      slice={slice}
      slicePosition={slicePosition}
      sliceRail={<SliceRail title={title} total={total} value={selectedIndex} onChange={changeSlice} disabled={!slice || !imageLoaded} className="overview-slice-rail" />}
      {...getViewport(series?.id)}
      contrast={contrast}
      brightness={brightness}
      inverted={inverted}
      onSelect={() => selectSeries(series)}
      onActivate={() => activateSeries(series)}
      onResetView={() => resetView(series?.id)}
      onImageLoad={() => setImageLoaded(true)}
      {...seriesInteractionProps(series?.id)}
    />
  )
}

export default function OverviewGrid({
  planeSeries,
  activeSeries,
  currentSlice,
  slices,
  currentIndex,
  overviewSliceIndices,
  onOverviewSliceChange,
  seriesSliceMap,
  getViewport,
  contrast,
  brightness,
  inverted,
  selectSeries,
  activateSeries,
  resetView,
  seriesInteractionProps,
  studyGeometry,
}) {
  const [overviewLayout, setOverviewLayout] = useState('3d-four-up')
  const previewItemsFor = (series) => series ? seriesSliceMap[series.id] || [] : []

  return (
    <>
      <div className="overview-layout-bar"><span className="tool-label">Overview layout</span>{[['3d-four-up', '3D four-up'], ['3d-primary', '3D primary'], ['3d-main', '3D main']].map(([value, label]) => <button key={value} className={`tool-button ${overviewLayout === value ? 'selected-control' : ''}`} onClick={() => setOverviewLayout(value)}>{label}</button>)}</div>
    <div className={`viewer-grid overview-grid overview-layout-${overviewLayout}`}>
      <LocatorCard activeSeries={activeSeries} studyGeometry={studyGeometry} />
      <OverviewImage title="Sagittal" series={planeSeries.SAG} previewItems={previewItemsFor(planeSeries.SAG)} activeSeries={activeSeries} currentSlice={currentSlice} slices={slices} currentIndex={currentIndex} overviewSliceIndices={overviewSliceIndices} onOverviewSliceChange={onOverviewSliceChange} getViewport={getViewport} contrast={contrast} brightness={brightness} inverted={inverted} selectSeries={selectSeries} activateSeries={activateSeries} resetView={resetView} seriesInteractionProps={seriesInteractionProps} />
      <OverviewImage title="Coronal" series={planeSeries.COR} previewItems={previewItemsFor(planeSeries.COR)} activeSeries={activeSeries} currentSlice={currentSlice} slices={slices} currentIndex={currentIndex} overviewSliceIndices={overviewSliceIndices} onOverviewSliceChange={onOverviewSliceChange} getViewport={getViewport} contrast={contrast} brightness={brightness} inverted={inverted} selectSeries={selectSeries} activateSeries={activateSeries} resetView={resetView} seriesInteractionProps={seriesInteractionProps} />
      <OverviewImage title="Axial" series={planeSeries.AX} previewItems={previewItemsFor(planeSeries.AX)} activeSeries={activeSeries} currentSlice={currentSlice} slices={slices} currentIndex={currentIndex} overviewSliceIndices={overviewSliceIndices} onOverviewSliceChange={onOverviewSliceChange} getViewport={getViewport} contrast={contrast} brightness={brightness} inverted={inverted} selectSeries={selectSeries} activateSeries={activateSeries} resetView={resetView} seriesInteractionProps={seriesInteractionProps} />
    </div>
    </>
  )
}

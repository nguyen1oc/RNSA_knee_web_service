import ImageCard from './ImageCard'
import LocatorCard from './LocatorCard'

function OverviewImage({ title, series, previewItems = [], activeSeries, currentSlice, slices, currentIndex, getViewport, contrast, brightness, inverted, selectSeries, activateSeries, resetView, seriesInteractionProps }) {
  const active = series?.id === activeSeries?.id
  const slicePosition = active
    ? (slices.length ? `${currentIndex + 1} / ${slices.length}` : '—')
    : previewItems.length ? `${Math.floor((previewItems.length - 1) / 2) + 1} / ${previewItems.length}` : '—'
  const slice = active ? currentSlice : previewItems[Math.max(0, Math.floor((previewItems.length - 1) / 2))]

  return (
    <ImageCard
      title={title}
      series={series}
      active={active}
      interactive={active}
      slice={slice}
      slicePosition={slicePosition}
      {...getViewport(series?.id)}
      contrast={contrast}
      brightness={brightness}
      inverted={inverted}
      onSelect={() => selectSeries(series)}
      onActivate={() => activateSeries(series)}
      onResetView={() => resetView(series?.id)}
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
  const previewItemsFor = (series) => series ? seriesSliceMap[series.id] || [] : []

  return (
    <div className="viewer-grid overview-grid">
      <LocatorCard activeSeries={activeSeries} studyGeometry={studyGeometry} />
      <OverviewImage title="Sagittal" series={planeSeries.SAG} previewItems={previewItemsFor(planeSeries.SAG)} activeSeries={activeSeries} currentSlice={currentSlice} slices={slices} currentIndex={currentIndex} getViewport={getViewport} contrast={contrast} brightness={brightness} inverted={inverted} selectSeries={selectSeries} activateSeries={activateSeries} resetView={resetView} seriesInteractionProps={seriesInteractionProps} />
      <OverviewImage title="Coronal" series={planeSeries.COR} previewItems={previewItemsFor(planeSeries.COR)} activeSeries={activeSeries} currentSlice={currentSlice} slices={slices} currentIndex={currentIndex} getViewport={getViewport} contrast={contrast} brightness={brightness} inverted={inverted} selectSeries={selectSeries} activateSeries={activateSeries} resetView={resetView} seriesInteractionProps={seriesInteractionProps} />
      <OverviewImage title="Axial" series={planeSeries.AX} previewItems={previewItemsFor(planeSeries.AX)} activeSeries={activeSeries} currentSlice={currentSlice} slices={slices} currentIndex={currentIndex} getViewport={getViewport} contrast={contrast} brightness={brightness} inverted={inverted} selectSeries={selectSeries} activateSeries={activateSeries} resetView={resetView} seriesInteractionProps={seriesInteractionProps} />
    </div>
  )
}

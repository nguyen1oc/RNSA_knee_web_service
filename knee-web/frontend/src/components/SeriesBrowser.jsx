import { ChevronRight, Image as ImageIcon } from 'lucide-react'

export default function SeriesBrowser({ study, activeSeriesId, sliceMap, onSelect }) {
  return (
    <section className="series-browser" aria-label="Images and series browser">
      <div className="series-browser-head">
        <div>
          <p className="eyebrow">Images / Series</p>
          <h3>Study acquisitions</h3>
          <p>Select a series to make it active, then use the direction tabs for focused reading.</p>
        </div>
        <span>{study.series.length} series</span>
      </div>
      <div className="series-browser-grid">
        {study.series.map((series) => {
          const items = sliceMap[series.id] || []
          const preview = items[Math.max(0, Math.floor((items.length - 1) / 2))]
          return (
            <button className={`series-browser-card ${activeSeriesId === series.id ? 'active' : ''}`} key={series.id} onClick={() => onSelect(series)}>
              <div className="series-browser-preview">{preview ? <img src={preview.image_url} alt={`${series.description || series.plane} representative slice`} /> : <ImageIcon size={22} />}</div>
              <div className="series-browser-copy">
                <div className="series-browser-title">
                  <span className="plane-token">{series.plane}</span>
                  <b>{series.description || 'DICOM series'}</b>
                  {activeSeriesId === series.id && <span className="selected-label">Active</span>}
                </div>
                <p>{series.slice_count} slices · {series.rows} × {series.cols}</p>
                <small>{series.fs_label || 'FS unknown'} · {series.fluid_label || 'Fluid unknown'}</small>
              </div>
              <ChevronRight size={17} />
            </button>
          )
        })}
      </div>
    </section>
  )
}

import { ChevronDown, ChevronRight, Database, Image as ImageIcon, RefreshCw, Trash2 } from 'lucide-react'
import { formatBytes } from '../uploadStudy'

function StudyItem({ study, active, activeSeriesId, expanded, expandedSeries, onToggle, onToggleSeries, onOpen, onOpenSeries, onDelete, sliceMap }) {
  return (
    <div className={`study-tree ${active ? 'active' : ''}`}>
      <div className="study-item">
        <button className="tree-caret" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${study.display_name}`} onClick={(event) => { event.stopPropagation(); onToggle() }}>
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <button className="study-main" onClick={onOpen}>
          <span className={`study-icon ${study.source}`}><Database size={16} /></span>
          <span className="study-copy"><b>{study.display_name}</b><small>{study.series.length} series · {study.total_slices} images</small></span>
        </button>
        {study.source === 'upload' && <button className="item-delete" title="Delete study" onClick={onDelete}><Trash2 size={14} /></button>}
      </div>

      {expanded && (
        <div className="tree-children">
          {study.series.map((series) => (
            <div className="series-tree" key={series.id}>
              <div className={`series-tree-row ${activeSeriesId === series.id ? 'selected' : ''} ${expandedSeries.has(series.id) ? 'open' : ''}`}>
                <button className="tree-caret" aria-label={`${expandedSeries.has(series.id) ? 'Collapse' : 'Expand'} ${series.description || 'series'}`} onClick={() => onToggleSeries(series.id)}>
                  {expandedSeries.has(series.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <button className="series-tree-main" onClick={() => onOpenSeries(series)}>
                  <span className="plane-token">{series.plane}</span>
                  <span><b>{series.description || 'DICOM series'}</b><small>{series.slice_count} DICOM slices</small></span>
                </button>
              </div>
              {expandedSeries.has(series.id) && (
                <div className="slice-tree">
                  {(sliceMap[series.id] || []).slice(0, 3).map((slice) => <span className="slice-tree-row" key={slice.id}><ImageIcon size={11} /> {slice.filename}</span>)}
                  <span className="slice-tree-more">{series.slice_count} slice files · open series to browse</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function StudySidebar({
  studies,
  activeStudyId,
  activeSeriesId,
  expandedStudies,
  expandedSeries,
  uploadProgress,
  onRefresh,
  onToggleStudy,
  onToggleSeries,
  onOpenStudy,
  onOpenSeries,
  onDeleteStudy,
  sliceMap,
}) {
  return (
    <aside className="library">
      <div className="library-head">
        <div><p className="eyebrow">Workspace</p><h2>Studies</h2></div>
        <button className="icon-button" title="Refresh" onClick={onRefresh}><RefreshCw size={16} /></button>
      </div>

      {uploadProgress && (
        <div className="upload-progress" role="status" aria-live="polite">
          <div className="upload-progress-heading">
            <b>{uploadProgress.phase === 'uploading' ? 'Uploading study' : 'Indexing study'}</b>
            {uploadProgress.phase === 'uploading' && <span>{uploadProgress.percent}%</span>}
          </div>
          {uploadProgress.phase === 'uploading' ? (
            <>
              <progress max="100" value={uploadProgress.percent} aria-label="Upload progress" />
              <small>{formatBytes(uploadProgress.loaded)} of about {formatBytes(uploadProgress.total)} · {uploadProgress.eta ? `about ${uploadProgress.eta} left for transfer` : 'estimating transfer time…'}</small>
            </>
          ) : (
            <small>{uploadProgress.fileCount} selected file(s) received. Validating and indexing; processing time depends on file count and size.</small>
          )}
        </div>
      )}

      <div className="library-divider"><span>Study library</span><em>{studies.length}</em></div>
      <div className="study-list">
        {studies.length ? studies.map((study) => (
          <StudyItem
            key={study.id}
            study={study}
            active={activeStudyId === study.id}
            activeSeriesId={activeSeriesId}
            expanded={expandedStudies.has(study.id)}
            expandedSeries={expandedSeries}
            onToggle={() => onToggleStudy(study.id)}
            onToggleSeries={onToggleSeries}
            onOpen={() => onOpenStudy(study.id)}
            onOpenSeries={(series) => onOpenSeries(study.id, series.id)}
            onDelete={() => onDeleteStudy(study)}
            sliceMap={activeStudyId === study.id ? sliceMap : {}}
          />
        )) : (
          <div className="empty-state"><Database size={24} /><p>No studies yet</p><small>Import DICOM files to start a local review.</small></div>
        )}
      </div>

      <div className="library-foot">
        <p>Pipeline: validate · metadata · group · sort · preview.</p>
      </div>
    </aside>
  )
}

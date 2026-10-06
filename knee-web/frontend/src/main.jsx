import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AlertCircle, ArrowLeft, ChevronDown, ChevronLeft, ChevronRight,
  Database, FileArchive, FolderOpen, Image as ImageIcon, Info, Minus, Plus,
  RefreshCw, Sparkles, Trash2, UploadCloud, X
} from 'lucide-react'
import './styles.css'

const api = async (path, options) => {
  const response = await fetch(path, options)
  if (!response.ok) {
    let message = response.statusText
    try { message = (await response.json()).detail || message } catch { /* no-op */ }
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message))
  }
  return response.json()
}

const tabs = [
  { label: 'Overview' },
  { label: 'Sagittal', plane: 'SAG' },
  { label: 'Coronal', plane: 'COR' },
  { label: 'Axial', plane: 'AX' },
  { label: 'Images / Series' },
]

function App() {
  const [studies, setStudies] = useState([])
  const [activeStudy, setActiveStudy] = useState(null)
  const [activeSeries, setActiveSeries] = useState(null)
  const [slices, setSlices] = useState([])
  const [seriesSliceMap, setSeriesSliceMap] = useState({})
  const [sliceIndex, setSliceIndex] = useState(null)
  const [viewerTab, setViewerTab] = useState('Overview')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState(null)
  const [viewportState, setViewportState] = useState({})
  const [contrast, setContrast] = useState(1.3)
  const [brightness, setBrightness] = useState(0.9)
  const [inverted, setInverted] = useState(false)
  const [expandedStudies, setExpandedStudies] = useState(new Set())
  const [expandedSeries, setExpandedSeries] = useState(new Set())
  const fileInput = useRef(null)
  const folderInput = useRef(null)
  const dragRef = useRef(null)

  const planeSeries = useMemo(() => ({
    SAG: activeStudy?.series.find((series) => series.plane === 'SAG'),
    COR: activeStudy?.series.find((series) => series.plane === 'COR'),
    AX: activeStudy?.series.find((series) => series.plane === 'AX'),
  }), [activeStudy])

  const refresh = async (openId) => {
    setLoading(true)
    try {
      const data = await api('/api/studies')
      setStudies(data)
      const target = openId || activeStudy?.id || data[0]?.id
      if (target) await openStudy(target, data)
      else { setActiveStudy(null); setLoading(false) }
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
      setLoading(false)
    }
  }

  const openStudy = async (id, knownStudies = studies, requestedSeriesId = null) => {
    setLoading(true)
    try {
      const detail = knownStudies.find((study) => study.id === id) || await api(`/api/studies/${id}`)
      const full = detail.series ? detail : await api(`/api/studies/${id}`)
      setActiveStudy(full)
      setExpandedStudies((current) => new Set(current).add(id))
      const preferred = full.series.find((series) => series.id === requestedSeriesId)
        || full.series.find((series) => series.plane === 'SAG')
        || full.series[0]
      await selectSeries(preferred)
      if (!requestedSeriesId) setViewerTab('Overview')
      return full
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
    } finally { setLoading(false) }
  }

  const selectSeries = async (series, { switchToDirection = true } = {}) => {
    if (!series) return
    setActiveSeries(series)
    if (switchToDirection) setViewerTab(series.plane === 'SAG' ? 'Sagittal' : series.plane === 'COR' ? 'Coronal' : series.plane === 'AX' ? 'Axial' : 'Images / Series')
    setSliceIndex(null)
    setSlices([])
    try {
      setSlices(await api(`/api/series/${series.id}/slices`))
    } catch (error) { setNotice({ type: 'error', text: error.message }) }
  }

  useEffect(() => {
    if (!activeStudy) return
    let cancelled = false
    Promise.all(activeStudy.series.map(async (series) => [series.id, await api(`/api/series/${series.id}/slices`)]))
      .then((entries) => { if (!cancelled) setSeriesSliceMap(Object.fromEntries(entries)) })
      .catch(() => { /* The active series still reports its own error. */ })
    return () => { cancelled = true }
  }, [activeStudy])

  useEffect(() => { refresh() }, [])

  const upload = async (event) => {
    const files = [...(event.target.files || [])]
    event.target.value = ''
    if (!files.length) return
    setUploading(true)
    setNotice({ type: 'info', text: `Validating and indexing ${files.length} DICOM file${files.length === 1 ? '' : 's'}…` })
    const form = new FormData()
    files.forEach((file) => form.append('files', file, file.name))
    try {
      const result = await api('/api/studies/upload', { method: 'POST', body: form })
      const rejectedText = result.rejected?.length ? ` ${result.rejected.length} file(s) skipped.` : ''
      setNotice({ type: 'success', text: `DICOM ingest complete: ${result.accepted_files} file(s) indexed.${rejectedText}` })
      await refresh(result.study_ids[0])
    } catch (error) { setNotice({ type: 'error', text: error.message }) }
    finally { setUploading(false) }
  }

  const deleteStudy = async (study) => {
    if (study.source === 'sample') return
    if (!window.confirm(`Delete “${study.display_name}”? This removes the local DICOM files.`)) return
    try {
      await api(`/api/studies/${study.id}`, { method: 'DELETE' })
      setNotice({ type: 'success', text: 'Study deleted.' })
      await refresh(activeStudy?.id === study.id ? undefined : activeStudy?.id)
    } catch (error) { setNotice({ type: 'error', text: error.message }) }
  }

  const analyzeStudy = () => setNotice({ type: 'info', text: 'Analyze is reserved for the upcoming AI pipeline. Triton inference is not connected in this local viewer yet.' })

  const toggleStudy = (studyId) => setExpandedStudies((current) => {
    const next = new Set(current)
    next.has(studyId) ? next.delete(studyId) : next.add(studyId)
    return next
  })

  const toggleSeries = (seriesId) => setExpandedSeries((current) => {
    const next = new Set(current)
    next.has(seriesId) ? next.delete(seriesId) : next.add(seriesId)
    return next
  })

  const changeTab = (tab) => {
    setViewerTab(tab.label)
    if (tab.plane) selectSeries(planeSeries[tab.plane])
  }

  const defaultViewport = { zoom: 1, pan: { x: 0, y: 0 }, fit: true }
  const getViewport = (seriesId) => viewportState[seriesId] || defaultViewport
  const updateViewport = (seriesId, updater) => {
    if (!seriesId) return
    setViewportState((current) => ({
      ...current,
      [seriesId]: typeof updater === 'function' ? updater(current[seriesId] || defaultViewport) : updater,
    }))
  }
  const resetView = (seriesId) => updateViewport(seriesId, defaultViewport)
  const changeZoom = (seriesId, delta) => updateViewport(seriesId, (current) => {
    const nextZoom = Math.max(1, current.zoom + delta)
    const nextFit = nextZoom === 1
    return { zoom: nextZoom, fit: nextFit, pan: nextFit ? { x: 0, y: 0 } : current.pan }
  })
  const handleWheel = (seriesId, event) => {
    if (!event.currentTarget.querySelector('img')) return
    event.preventDefault()
    changeZoom(seriesId, event.deltaY > 0 ? -0.15 : 0.15)
  }
  const handlePointerDown = (seriesId, event) => {
    const current = getViewport(seriesId)
    if (current.zoom <= 1 && current.fit) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      seriesId,
      startX: event.clientX,
      startY: event.clientY,
      originX: current.pan.x,
      originY: current.pan.y,
    }
  }
  const handlePointerMove = (event) => {
    if (!dragRef.current) return
    const { seriesId } = dragRef.current
    updateViewport(seriesId, (current) => ({
      ...current,
      pan: {
        x: dragRef.current.originX + event.clientX - dragRef.current.startX,
        y: dragRef.current.originY + event.clientY - dragRef.current.startY,
      },
    }))
  }
  const handlePointerUp = (event) => {
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  const currentIndex = slices.length
    ? (sliceIndex === null ? Math.floor((slices.length - 1) / 2) : Math.min(sliceIndex, slices.length - 1))
    : 0
  const currentSlice = slices[currentIndex]
  const representativeSlice = (seriesId) => {
    const items = seriesSliceMap[seriesId] || []
    return items[Math.max(0, Math.floor((items.length - 1) / 2))]
  }
  const seriesPosition = (seriesId) => {
    const items = seriesSliceMap[seriesId] || []
    return items.length ? `${Math.max(0, Math.floor((items.length - 1) / 2)) + 1} / ${items.length}` : '—'
  }
  const activateSeries = (series) => {
    if (!series || activeSeries?.id === series.id) return
    selectSeries(series, { switchToDirection: false })
  }
  const focusedPlane = viewerTab === 'Sagittal' ? 'SAG' : viewerTab === 'Coronal' ? 'COR' : viewerTab === 'Axial' ? 'AX' : null
  const focusedSeries = focusedPlane ? planeSeries[focusedPlane] : null
  const focusedSlice = focusedSeries?.id === activeSeries?.id ? currentSlice : representativeSlice(focusedSeries?.id)
  const focusedPosition = focusedSeries?.id === activeSeries?.id ? (slices.length ? `${currentIndex + 1} / ${slices.length}` : '—') : seriesPosition(focusedSeries?.id)
  const activeView = getViewport(activeSeries?.id)
  const seriesInteractionProps = (seriesId) => ({
    pan: getViewport(seriesId).pan,
    onWheel: (event) => handleWheel(seriesId, event),
    onPointerDown: (event) => handlePointerDown(seriesId, event),
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerUp,
  })

  if (loading && !activeStudy) return <div className="loading-screen"><div className="brand-mark">KR</div><p>Loading local workspace…</p></div>

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">KR</div><div><h1>Knee Review</h1><span>Local DICOM workspace</span></div></div>
      <div className="top-actions"><span className="status-dot"><i /> Local only</span><button className="button primary" onClick={() => fileInput.current?.click()} disabled={uploading}><UploadCloud size={16} /> Import study</button><input ref={fileInput} hidden type="file" accept=".dcm,application/dicom" multiple onChange={upload} /><input ref={folderInput} hidden type="file" webkitdirectory="true" multiple onChange={upload} /></div>
    </header>
    {notice && <div className={`notice ${notice.type}`}><span>{notice.type === 'error' ? <AlertCircle size={16} /> : <Info size={16} />}{notice.text}</span><button aria-label="Dismiss notice" onClick={() => setNotice(null)}><X size={15} /></button></div>}
    <div className="body-layout">
      <aside className="library">
        <div className="library-head"><div><p className="eyebrow">Workspace</p><h2>Studies</h2></div><button className="icon-button" title="Refresh" onClick={() => refresh()}><RefreshCw size={16} /></button></div>
        <button className="drop-card" onClick={() => fileInput.current?.click()} disabled={uploading}><UploadCloud size={20} /><span><b>{uploading ? 'Ingesting…' : 'Import DICOM study'}</b><small>Choose .dcm files or a folder</small></span><Plus size={17} /></button>
        <div className="library-divider"><span>Study library</span><em>{studies.length}</em></div>
        <div className="study-list">{studies.length ? studies.map((study) => <StudyItem key={study.id} study={study} active={activeStudy?.id === study.id} activeSeriesId={activeSeries?.id} expanded={expandedStudies.has(study.id)} expandedSeries={expandedSeries} onToggle={() => toggleStudy(study.id)} onToggleSeries={toggleSeries} onOpen={() => openStudy(study.id)} onOpenSeries={(series) => openStudy(study.id, studies, series.id)} onDelete={() => deleteStudy(study)} sliceMap={activeStudy?.id === study.id ? seriesSliceMap : {}} />) : <div className="empty-state"><Database size={24} /><p>No studies yet</p><small>Import DICOM files to start a local review.</small></div>}</div>
        <div className="library-foot"><button className="folder-button" onClick={() => folderInput.current?.click()}><FolderOpen size={15} /> Import folder</button><p>Pipeline: validate · metadata · group · sort · preview.</p></div>
      </aside>
      <main className="content">
        {!activeStudy ? <EmptyWorkspace onImport={() => fileInput.current?.click()} /> : <>
          <div className="content-head"><div><button className="back-button" onClick={() => setActiveStudy(null)}><ArrowLeft size={15} /> Study library</button><div className="title-row"><h2>{activeStudy.display_name}</h2><span className={`source-badge ${activeStudy.source}`}>{activeStudy.source === 'sample' ? 'Example' : 'Imported'}</span></div><p className="subline">{activeStudy.series.length} series · {activeStudy.total_slices} images · UID ending {activeStudy.study_uid.slice(-12)}</p></div><div className="head-actions"><button className="button analyze-button" onClick={analyzeStudy}><Sparkles size={15} /> Analyze <span>Coming soon</span></button><button className="button ghost" onClick={() => deleteStudy(activeStudy)} disabled={activeStudy.source === 'sample'}><Trash2 size={15} /> Delete study</button></div></div>
          <div className="viewer-shell">
            <section className="viewer-pane" aria-label="DICOM viewer">
              <nav className="viewer-tabs" aria-label="Viewer tabs">{tabs.map((tab) => <button key={tab.label} className={`viewer-tab ${viewerTab === tab.label ? 'active' : ''}`} onClick={() => changeTab(tab)}>{tab.label}</button>)}</nav>
              <div className="viewer-toolbar"><div className="toolbar-group"><label>Active series</label><select value={activeSeries?.id || ''} onChange={(event) => selectSeries(activeStudy.series.find((series) => series.id === event.target.value))}>{activeStudy.series.map((series) => <option key={series.id} value={series.id}>{series.plane} · {series.description || 'DICOM series'} · {series.slice_count} slices</option>)}</select></div><div className="toolbar-group compact"><label>Slice</label><button className="icon-button" aria-label="Previous slice" onClick={() => setSliceIndex(Math.max(0, currentIndex - 1))}><ChevronLeft size={16} /></button><span className="slice-count">{slices.length ? `${currentIndex + 1} / ${slices.length}` : '—'}</span><button className="icon-button" aria-label="Next slice" onClick={() => setSliceIndex(Math.min(Math.max(slices.length - 1, 0), currentIndex + 1))}><ChevronRight size={16} /></button></div><div className="toolbar-spacer" /><div className="toolbar-group compact"><label>Zoom</label><button className="icon-button" aria-label="Zoom out" onClick={() => changeZoom(activeSeries?.id, -.25)} disabled={activeView.zoom === 1}><Minus size={15} /></button><span className="zoom-value">{Math.round(activeView.zoom * 100)}%</span><button className="icon-button" aria-label="Zoom in" onClick={() => changeZoom(activeSeries?.id, .25)}><Plus size={15} /></button><button className="button ghost small" onClick={() => resetView(activeSeries?.id)}>Reset</button></div></div>
              <div className="display-toolbar"><span className="display-label">Image display</span><label>Contrast <input aria-label="Image contrast" type="range" min="0.8" max="2" step="0.05" value={contrast} onChange={(event) => setContrast(Number(event.target.value))} /></label><span className="range-value">{contrast.toFixed(2)}</span><label>Brightness <input aria-label="Image brightness" type="range" min="0.65" max="1.25" step="0.05" value={brightness} onChange={(event) => setBrightness(Number(event.target.value))} /></label><span className="range-value">{brightness.toFixed(2)}</span><button className={`button ghost small ${inverted ? 'selected-control' : ''}`} onClick={() => setInverted(!inverted)}>Invert</button><button className="button ghost small" onClick={() => { setContrast(1.3); setBrightness(.9); setInverted(false) }}>Reset display</button></div>
              {viewerTab === 'Overview' ? <div className="viewer-grid overview-grid"><LocatorCard activeSeries={activeSeries} studyGeometry={activeStudy.geometry} /><ImageCard title="Sagittal" series={planeSeries.SAG} active={planeSeries.SAG?.id === activeSeries?.id} interactive={planeSeries.SAG?.id === activeSeries?.id} slice={planeSeries.SAG?.id === activeSeries?.id ? currentSlice : representativeSlice(planeSeries.SAG?.id)} slicePosition={planeSeries.SAG?.id === activeSeries?.id ? (slices.length ? `${currentIndex + 1} / ${slices.length}` : '—') : seriesPosition(planeSeries.SAG?.id)} {...getViewport(planeSeries.SAG?.id)} contrast={contrast} brightness={brightness} inverted={inverted} onSelect={() => selectSeries(planeSeries.SAG)} onActivate={() => activateSeries(planeSeries.SAG)} onResetView={() => resetView(planeSeries.SAG?.id)} {...seriesInteractionProps(planeSeries.SAG?.id)} /><ImageCard title="Coronal" series={planeSeries.COR} active={planeSeries.COR?.id === activeSeries?.id} interactive={planeSeries.COR?.id === activeSeries?.id} slice={planeSeries.COR?.id === activeSeries?.id ? currentSlice : representativeSlice(planeSeries.COR?.id)} slicePosition={planeSeries.COR?.id === activeSeries?.id ? (slices.length ? `${currentIndex + 1} / ${slices.length}` : '—') : seriesPosition(planeSeries.COR?.id)} {...getViewport(planeSeries.COR?.id)} contrast={contrast} brightness={brightness} inverted={inverted} onSelect={() => selectSeries(planeSeries.COR)} onActivate={() => activateSeries(planeSeries.COR)} onResetView={() => resetView(planeSeries.COR?.id)} {...seriesInteractionProps(planeSeries.COR?.id)} /><ImageCard title="Axial" series={planeSeries.AX} active={planeSeries.AX?.id === activeSeries?.id} interactive={planeSeries.AX?.id === activeSeries?.id} slice={planeSeries.AX?.id === activeSeries?.id ? currentSlice : representativeSlice(planeSeries.AX?.id)} slicePosition={planeSeries.AX?.id === activeSeries?.id ? (slices.length ? `${currentIndex + 1} / ${slices.length}` : '—') : seriesPosition(planeSeries.AX?.id)} {...getViewport(planeSeries.AX?.id)} contrast={contrast} brightness={brightness} inverted={inverted} onSelect={() => selectSeries(planeSeries.AX)} onActivate={() => activateSeries(planeSeries.AX)} onResetView={() => resetView(planeSeries.AX?.id)} {...seriesInteractionProps(planeSeries.AX?.id)} /></div> : viewerTab === 'Images / Series' ? <SeriesBrowser study={activeStudy} activeSeriesId={activeSeries?.id} sliceMap={seriesSliceMap} onSelect={(series) => selectSeries(series, { switchToDirection: false })} /> : <div className="focused-view"><ImageCard title={viewerTab} series={focusedSeries} active interactive slice={focusedSlice} slicePosition={focusedPosition} focused {...getViewport(focusedSeries?.id)} contrast={contrast} brightness={brightness} inverted={inverted} onSelect={() => selectSeries(focusedSeries)} onResetView={() => resetView(focusedSeries?.id)} {...seriesInteractionProps(focusedSeries?.id)} /></div>}
              <div className="viewer-footer"><span><ImageIcon size={14} /> {currentSlice?.filename || 'Select a series to view images'}</span><span>Preview pipeline complete · Window / level metadata applied when available</span></div>
            </section>
            <StudyInfoPanel study={activeStudy} />
          </div>
        </>}
      </main>
    </div>
  </div>
}

function StudyItem({ study, active, activeSeriesId, expanded, expandedSeries, onToggle, onToggleSeries, onOpen, onOpenSeries, onDelete, sliceMap }) {
  return <div className={`study-tree ${active ? 'active' : ''}`}><div className="study-item"><button className="tree-caret" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${study.display_name}`} onClick={(event) => { event.stopPropagation(); onToggle() }}>{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button><button className="study-main" onClick={onOpen}><span className={`study-icon ${study.source}`}><Database size={16} /></span><span className="study-copy"><b>{study.display_name}</b><small>{study.series.length} series · {study.total_slices} images</small></span></button>{study.source === 'upload' && <button className="item-delete" title="Delete study" onClick={onDelete}><Trash2 size={14} /></button>}</div>{expanded && <div className="tree-children">{study.series.map((series) => <div className="series-tree" key={series.id}><div className={`series-tree-row ${activeSeriesId === series.id ? 'selected' : ''} ${expandedSeries.has(series.id) ? 'open' : ''}`}><button className="tree-caret" aria-label={`${expandedSeries.has(series.id) ? 'Collapse' : 'Expand'} ${series.description || 'series'}`} onClick={() => onToggleSeries(series.id)}>{expandedSeries.has(series.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button><button className="series-tree-main" onClick={() => onOpenSeries(series)}><span className="plane-token">{series.plane}</span><span><b>{series.description || 'DICOM series'}</b><small>{series.slice_count} DICOM slices</small></span></button></div>{expandedSeries.has(series.id) && <div className="slice-tree">{(sliceMap[series.id] || []).slice(0, 3).map((slice) => <span className="slice-tree-row" key={slice.id}><ImageIcon size={11} /> {slice.filename}</span>)}<span className="slice-tree-more">{series.slice_count} slice files · open series to browse</span></div>}</div>)}</div>}</div>
}

function LocatorCard({ activeSeries, studyGeometry }) {
  const mappingReady = Boolean(studyGeometry?.mapping_ready)
  return <article className="viewer-card locator-card"><div className="card-head"><div><span className="card-kicker">Orientation</span><h3>3D locator</h3></div><span className="planned-badge">P1</span></div><div className="locator-stage"><div className="locator-cube"><div className="cube-face cube-front" /><div className="cube-face cube-side" /><div className="cube-face cube-top" /><span className="axis-label axis-x">R</span><span className="axis-label axis-y">A</span><span className="axis-label axis-z">S</span></div><div className="crosshair crosshair-h" /><div className="crosshair crosshair-v" /><span className="locator-caption">{activeSeries ? `${activeSeries.plane} series selected` : 'Select a series'}</span></div><div className="card-foot"><span><Info size={13} /> {mappingReady ? 'Geometry validated · patient mapping ready' : 'Orientation locator only · geometry mapping unavailable'}</span></div></article>
}

function SeriesBrowser({ study, activeSeriesId, sliceMap, onSelect }) {
  return <section className="series-browser" aria-label="Images and series browser"><div className="series-browser-head"><div><p className="eyebrow">Images / Series</p><h3>Study acquisitions</h3><p>Select a series to make it active, then use the direction tabs for focused reading.</p></div><span>{study.series.length} series</span></div><div className="series-browser-grid">{study.series.map((series) => { const items = sliceMap[series.id] || []; const preview = items[Math.max(0, Math.floor((items.length - 1) / 2))]; return <button className={`series-browser-card ${activeSeriesId === series.id ? 'active' : ''}`} key={series.id} onClick={() => onSelect(series)}><div className="series-browser-preview">{preview ? <img src={preview.image_url} alt={`${series.description || series.plane} representative slice`} /> : <ImageIcon size={22} />}</div><div className="series-browser-copy"><div className="series-browser-title"><span className="plane-token">{series.plane}</span><b>{series.description || 'DICOM series'}</b>{activeSeriesId === series.id && <span className="selected-label">Active</span>}</div><p>{series.slice_count} slices · {series.rows} × {series.cols}</p><small>{series.fs_label || 'FS unknown'} · {series.fluid_label || 'Fluid unknown'}</small></div><ChevronRight size={17} /></button> })}</div></section>
}

function ImageCard({ title, series, active, interactive = active, slice, slicePosition, focused = false, zoom, fit, pan = { x: 0, y: 0 }, contrast, brightness, inverted, onSelect, onActivate, onResetView, onWheel, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }) {
  const available = Boolean(series)
  const loading = available && !slice
  const imageFilter = `${inverted ? 'invert(1) ' : ''}contrast(${contrast}) brightness(${brightness})`
  const canPan = interactive && available && !loading && (zoom > 1 || !fit)
  return <article className={`viewer-card image-card ${active ? 'active' : ''} ${focused ? 'focused' : ''}`}><div className="card-head"><div><span className="card-kicker">{title}</span><h3>{available ? series.description || 'DICOM series' : 'Not available'}</h3></div><div className="card-actions">{available && <button className="card-open" onClick={onSelect} aria-label={`Open ${title} view`}>Open</button>}{available && <button className="card-reset" onClick={onResetView} aria-label={`Reset ${title} view`} disabled={!interactive || (zoom === 1 && fit && pan.x === 0 && pan.y === 0)}>Reset view</button>}</div></div><div className={`image-stage ${!available || loading ? 'unavailable' : ''} ${canPan ? 'zoomed can-pan' : ''}`} onWheel={interactive && available && !loading ? onWheel : undefined} onPointerDown={canPan ? onPointerDown : undefined} onPointerMove={canPan ? onPointerMove : undefined} onPointerUp={canPan ? onPointerUp : undefined} onPointerCancel={canPan ? onPointerCancel : undefined} onClick={available && !loading ? onActivate : undefined}>{available && slice ? <img src={slice.image_url} alt={`${title} DICOM slice`} draggable="false" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, filter: imageFilter, opacity: fit ? 1 : .98 }} /> : <div className="unavailable-copy"><ImageIcon size={24} /><b>{loading ? 'Loading slice…' : `No ${title.toLowerCase()} series`}</b><span>{loading ? 'Preparing the first image for this acquisition.' : `This study does not contain a mapped ${title.toLowerCase()} acquisition.`}</span></div>}</div><div className="card-foot">{available ? <span>{slicePosition || `${series.slice_count} slices`} · {series.rows} × {series.cols}</span> : <span>Direction unavailable</span>} {active && <span className="selected-label">Active</span>}</div></article>
}

function StudyInfoPanel({ study }) {
  const stages = study.pipeline?.stages || []
  const geometries = study.series.map((series) => series.geometry || { status: series.geometry_status || 'unknown', mapping_ready: false })
  const validGeometry = geometries.filter((geometry) => geometry.status === 'valid').length
  const mappingReady = study.geometry?.mapping_ready ? 1 : 0
  const geometrySummary = `${validGeometry} / ${geometries.length} valid`
  const mappingSummary = mappingReady ? 'Ready' : study.geometry?.status === 'incompatible' ? 'Incompatible frames' : 'Unavailable'
  return <aside className="study-info-panel" aria-label="Study information"><p className="eyebrow">Study information</p><h3>Source details</h3><span className={`info-status ${study.source}`}>{study.source === 'sample' ? 'Example study' : 'Imported study'}</span><div className="info-rows"><div><span>Input</span><b>DICOM `.dcm`</b></div><div><span>Series</span><b>{study.series.length}</b></div><div><span>Images</span><b>{study.total_slices}</b></div><div><span>Geometry</span><b>{geometrySummary}</b></div><div><span>3D mapping</span><b>{mappingSummary}</b></div><div><span>Study UID</span><b title={study.study_uid}>…{study.study_uid.slice(-12)}</b></div></div><div className="info-divider" /><p className="eyebrow">Ingest pipeline</p><ul className="pipeline-list">{stages.map((stage) => <li key={stage.key}><span className={`pipeline-dot ${stage.status}`} /><span>{stage.label}</span><small>{stage.status === 'on_demand' ? 'On demand' : 'Complete'}</small></li>)}</ul><div className="info-note"><Info size={14} /><span>Display controls affect presentation only. Source DICOM files remain unchanged.</span></div></aside>
}

function EmptyWorkspace({ onImport }) {
  return <div className="empty-workspace"><div className="empty-illustration"><UploadCloud size={34} /></div><p className="eyebrow">Local DICOM workspace</p><h2>Start a knee image review</h2><p>Import a study to browse its series and slices. Files stay on this machine; no account or AI service is required.</p><button className="button primary" onClick={onImport}><UploadCloud size={16} /> Import DICOM study</button><div className="empty-note"><FileArchive size={15} /> Supports individual <b>.dcm</b> files and folders. ZIP import will be added later.</div></div>
}

createRoot(document.getElementById('root')).render(<App />)

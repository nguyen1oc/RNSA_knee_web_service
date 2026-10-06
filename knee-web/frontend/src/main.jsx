import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertCircle, ArrowLeft, Image as ImageIcon, Info, Sparkles, Trash2, UploadCloud, X } from 'lucide-react'
import './styles.css'
import './viewer-overrides.css'

import DisplayToolbar from './components/DisplayToolbar'
import EmptyWorkspace from './components/EmptyWorkspace'
import FocusedViewer from './components/FocusedViewer'
import OverviewGrid from './components/OverviewGrid'
import SeriesBrowser from './components/SeriesBrowser'
import StudyInfoPanel from './components/StudyInfoPanel'
import StudySidebar from './components/StudySidebar'
import ViewerTabs from './components/ViewerTabs'
import ViewerToolbar from './components/ViewerToolbar'

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
  const [overviewSliceIndices, setOverviewSliceIndices] = useState({})
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
      await selectSeries(preferred, { switchToDirection: false })
      if (!requestedSeriesId) setViewerTab('Overview')
      return full
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
    } finally {
      setLoading(false)
    }
  }

  const selectSeries = async (series, { switchToDirection = true } = {}) => {
    if (!series) return
    setActiveSeries(series)
    if (switchToDirection) {
      setViewerTab(series.plane === 'SAG' ? 'Sagittal' : series.plane === 'COR' ? 'Coronal' : series.plane === 'AX' ? 'Axial' : 'Images / Series')
      setSliceIndex(0)
    } else {
      setSliceIndex(null)
    }
    setSlices([])
    try {
      setSlices(await api(`/api/series/${series.id}/slices`))
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
    }
  }

  useEffect(() => {
    if (!activeStudy) return undefined
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
    setNotice({ type: 'info', text: `Validating and indexing ${files.length} DICOM file or ZIP archive${files.length === 1 ? '' : 's'}…` })
    const form = new FormData()
    files.forEach((file) => form.append('files', file, file.name))
    try {
      const result = await api('/api/studies/upload', { method: 'POST', body: form })
      const rejectedText = result.rejected?.length ? ` ${result.rejected.length} file(s) skipped.` : ''
      setNotice({ type: 'success', text: `DICOM ingest complete: ${result.accepted_files} file(s) indexed.${rejectedText}` })
      await refresh(result.study_ids[0])
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
    } finally {
      setUploading(false)
    }
  }

  const deleteStudy = async (study) => {
    if (study.source === 'sample') return
    if (!window.confirm(`Delete “${study.display_name}”? This removes the local DICOM files.`)) return
    try {
      await api(`/api/studies/${study.id}`, { method: 'DELETE' })
      setNotice({ type: 'success', text: 'Study deleted.' })
      await refresh(activeStudy?.id === study.id ? undefined : activeStudy?.id)
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
    }
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
    event.stopPropagation()
    if (viewerTab === 'Overview') {
      if (seriesId !== activeSeries?.id || !slices.length) return
      setSliceIndex((current) => {
        const index = current === null ? Math.floor((slices.length - 1) / 2) : current
        return Math.min(Math.max(index + (event.deltaY > 0 ? 1 : -1), 0), slices.length - 1)
      })
      return
    }
    changeZoom(seriesId, event.deltaY > 0 ? -0.15 : 0.15)
  }
  const handlePointerDown = (seriesId, event) => {
    const current = getViewport(seriesId)
    if (current.zoom <= 1 && current.fit) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = { seriesId, startX: event.clientX, startY: event.clientY, originX: current.pan.x, originY: current.pan.y }
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
  const activateSeries = (series) => {
    if (!series || activeSeries?.id === series.id) return
    selectSeries(series, { switchToDirection: false })
  }
  const focusedPlane = viewerTab === 'Sagittal' ? 'SAG' : viewerTab === 'Coronal' ? 'COR' : viewerTab === 'Axial' ? 'AX' : null
  const focusedSeries = focusedPlane ? planeSeries[focusedPlane] : null
  const focusedItems = seriesSliceMap[focusedSeries?.id] || []
  const focusedSlices = focusedSeries?.id === activeSeries?.id ? slices : focusedItems
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

  const viewerContent = viewerTab === 'Overview' ? (
      <OverviewGrid
      planeSeries={planeSeries}
      activeSeries={activeSeries}
      currentSlice={currentSlice}
      slices={slices}
        currentIndex={currentIndex}
        overviewSliceIndices={overviewSliceIndices}
        onOverviewSliceChange={(seriesId, index) => {
          setOverviewSliceIndices((current) => ({ ...current, [seriesId]: index }))
          if (seriesId === activeSeries?.id) setSliceIndex(index)
        }}
      seriesSliceMap={seriesSliceMap}
      getViewport={getViewport}
      contrast={contrast}
      brightness={brightness}
      inverted={inverted}
      selectSeries={selectSeries}
      activateSeries={activateSeries}
      resetView={resetView}
      seriesInteractionProps={seriesInteractionProps}
      studyGeometry={activeStudy.geometry}
    />
  ) : viewerTab === 'Images / Series' ? (
    <SeriesBrowser study={activeStudy} activeSeriesId={activeSeries?.id} sliceMap={seriesSliceMap} onSelect={(series) => selectSeries(series, { switchToDirection: false })} />
  ) : (
    <FocusedViewer
      series={focusedSeries}
      slices={focusedSlices}
      currentIndex={currentIndex}
      onActiveSliceChange={setSliceIndex}
      contrast={contrast}
      brightness={brightness}
      inverted={inverted}
      geometryReady={Boolean(activeStudy.geometry?.mapping_ready)}
    />
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark">KR</div><div><h1>Knee Review</h1><span>Local DICOM workspace</span></div></div>
        <div className="top-actions"><span className="status-dot"><i /> Local only</span><button className="button primary" onClick={() => fileInput.current?.click()} disabled={uploading}><UploadCloud size={16} /> Import study</button><input ref={fileInput} hidden type="file" accept=".dcm,.zip,application/dicom,application/zip" multiple onChange={upload} /><input ref={folderInput} hidden type="file" webkitdirectory="true" multiple onChange={upload} /></div>
      </header>

      {notice && <div className={`notice ${notice.type}`}><span>{notice.type === 'error' ? <AlertCircle size={16} /> : <Info size={16} />}{notice.text}</span><button aria-label="Dismiss notice" onClick={() => setNotice(null)}><X size={15} /></button></div>}

      <div className="body-layout">
        <StudySidebar
          studies={studies}
          activeStudyId={activeStudy?.id}
          activeSeriesId={activeSeries?.id}
          expandedStudies={expandedStudies}
          expandedSeries={expandedSeries}
          uploading={uploading}
          onRefresh={() => refresh()}
          onImport={() => fileInput.current?.click()}
          onImportFolder={() => folderInput.current?.click()}
          onToggleStudy={toggleStudy}
          onToggleSeries={toggleSeries}
          onOpenStudy={(id) => openStudy(id)}
          onOpenSeries={(id, seriesId) => openStudy(id, studies, seriesId)}
          onDeleteStudy={deleteStudy}
          sliceMap={seriesSliceMap}
        />

        <main className="content">
          {!activeStudy ? <EmptyWorkspace onImport={() => fileInput.current?.click()} /> : (
            <>
              <div className="content-head">
                <div><button className="back-button" onClick={() => setActiveStudy(null)}><ArrowLeft size={15} /> Study library</button><div className="title-row"><h2>{activeStudy.display_name}</h2><span className={`source-badge ${activeStudy.source}`}>{activeStudy.source === 'sample' ? 'Example' : 'Imported'}</span></div><p className="subline">{activeStudy.series.length} series · {activeStudy.total_slices} images · UID ending {activeStudy.study_uid.slice(-12)}</p></div>
                <div className="head-actions"><button className="button analyze-button" onClick={analyzeStudy}><Sparkles size={15} /> Analyze <span>Coming soon</span></button><button className="button ghost" onClick={() => deleteStudy(activeStudy)} disabled={activeStudy.source === 'sample'}><Trash2 size={15} /> Delete study</button></div>
              </div>

              <div className="viewer-shell">
                <section className="viewer-pane" aria-label="DICOM viewer">
                  <ViewerTabs tabs={tabs} activeTab={viewerTab} onChange={changeTab} />
                  <ViewerToolbar activeStudy={activeStudy} activeSeries={activeSeries} selectSeries={selectSeries} currentIndex={currentIndex} slices={slices} setSliceIndex={setSliceIndex} activeView={activeView} changeZoom={changeZoom} resetView={resetView} showZoom={viewerTab === 'Overview'} />
                  <DisplayToolbar contrast={contrast} brightness={brightness} inverted={inverted} setContrast={setContrast} setBrightness={setBrightness} setInverted={setInverted} />
                  {viewerContent}
                  <div className="viewer-footer"><span><ImageIcon size={14} /> {currentSlice?.filename || 'Select a series to view images'}</span><span>Preview pipeline complete · Window / level metadata applied when available</span></div>
                </section>
                <StudyInfoPanel study={activeStudy} />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)

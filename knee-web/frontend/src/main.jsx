import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertCircle, Image as ImageIcon, Info, Sparkles, Trash2, UploadCloud, X } from 'lucide-react'
import './styles.css'
import './upload-progress.css'
import './viewer-overrides.css'
import { clearTemporarySession, getSessionHeaders, initializeSession } from './session'
import SessionControls from './components/SessionControls'
import ConfirmationDialog from './components/ConfirmationDialog'

import MprViewer from './components/MprViewer'
import './native-viewer.css'
import EmptyWorkspace from './components/EmptyWorkspace'
import FocusedViewer from './components/FocusedViewer'
import SeriesBrowser from './components/SeriesBrowser'
import StudyInfoPanel from './components/StudyInfoPanel'
import StudySidebar from './components/StudySidebar'
import ViewerTabs from './components/ViewerTabs'
import ViewerToolbar from './components/ViewerToolbar'
import { uploadStudy } from './uploadStudy'
import { apiFetch } from './api'

const api = async (path, options) => {
  const sessionHeaders = await getSessionHeaders()
  const response = await apiFetch(path, { ...options, headers: { ...sessionHeaders, ...(options?.headers || {}) } })
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

function chooseInitialMprSource(series = []) {
  return [...series].sort((a, b) => {
    const geometryRank = Number(b.geometry_status === 'valid') - Number(a.geometry_status === 'valid')
    const orientationRank = Number(b.plane === 'SAG') - Number(a.plane === 'SAG')
    return geometryRank || orientationRank || b.slice_count - a.slice_count
  })[0]
}

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
  const [uploadProgress, setUploadProgress] = useState(null)
  const [clearingSession, setClearingSession] = useState(false)
  const [confirmation, setConfirmation] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [notice, setNotice] = useState(null)
  const [expandedStudies, setExpandedStudies] = useState(new Set())
  const [expandedSeries, setExpandedSeries] = useState(new Set())
  const fileInput = useRef(null)
  const folderInput = useRef(null)
  const seriesRequest = useRef(0)

  const planeSeries = useMemo(() => Object.fromEntries(['SAG', 'COR', 'AX'].map((plane) => [
    plane, activeSeries?.plane === plane ? activeSeries : activeStudy?.series.find((series) => series.plane === plane),
  ])), [activeStudy, activeSeries])

  const refresh = async (openId, { fallbackToActive = true } = {}) => {
    setLoading(true)
    try {
      const data = await api('/api/studies')
      setStudies(data)
      const target = openId || (fallbackToActive ? activeStudy?.id : null) || data[0]?.id
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
        || chooseInitialMprSource(full.series)
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
    const request = ++seriesRequest.current
    setActiveSeries(series)
    if (switchToDirection) {
      setViewerTab(series.plane === 'SAG' ? 'Sagittal' : series.plane === 'COR' ? 'Coronal' : series.plane === 'AX' ? 'Axial' : 'Images / Series')
      setSliceIndex(0)
    } else {
      setSliceIndex(null)
    }
    setSlices(seriesSliceMap[series.id] || [])
    try {
      const items = await api(`/api/series/${series.id}/slices`)
      if (request === seriesRequest.current) setSlices(items)
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

  useEffect(() => {
    let cancelled = false
    initializeSession()
      .then(() => { if (!cancelled) refresh() })
      .catch((error) => {
        if (cancelled) return
        setNotice({ type: 'error', text: error.message })
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const upload = async (event) => {
    const files = [...(event.target.files || [])]
    event.target.value = ''
    if (!files.length) return
    setUploading(true)
    setNotice(null)
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
    const startedAt = Date.now()
    setUploadProgress({ phase: 'uploading', fileCount: files.length, loaded: 0, total: totalBytes, percent: 0, eta: null })
    const form = new FormData()
    files.forEach((file) => form.append('files', file, file.name))
    try {
      const result = await uploadStudy(form, (progress) => {
        setUploadProgress({ ...progress, fileCount: files.length })
      }, startedAt)
      const rejectedText = result.rejected?.length ? ` ${result.rejected.length} file(s) skipped.` : ''
      setNotice({ type: 'success', text: `DICOM ingest complete: ${result.accepted_files} file(s) indexed.${rejectedText}` })
      await refresh(result.study_ids[0])
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
    } finally {
      setUploading(false)
      setUploadProgress(null)
    }
  }

  const deleteStudy = async (study) => {
    if (study.source === 'sample') return
    setConfirmation({
      title: 'Delete this study?',
      description: `“${study.display_name}” and its local DICOM files will be removed from this temporary workspace. This cannot be undone.`,
      confirmLabel: 'Delete study',
      onConfirm: async () => {
        const deletingActiveStudy = activeStudy?.id === study.id
        try {
          await api(`/api/studies/${study.id}`, { method: 'DELETE' })
          setNotice({ type: 'success', text: 'Study deleted.' })
          await refresh(deletingActiveStudy ? undefined : activeStudy?.id, { fallbackToActive: !deletingActiveStudy })
        } catch (error) {
          setNotice({ type: 'error', text: error.message })
        }
      },
    })
  }

  const analyzeStudy = () => setNotice({ type: 'analyze', text: 'Analyze is reserved for the upcoming AI pipeline. Triton inference is not connected in this local viewer yet.' })

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

  const currentIndex = slices.length
    ? (sliceIndex === null ? Math.floor((slices.length - 1) / 2) : Math.min(sliceIndex, slices.length - 1))
    : 0
  const currentSlice = slices[currentIndex]
  const clearWorkspace = () => {
    setConfirmation({
      title: 'Clear this temporary session?',
      description: 'All studies you uploaded in this browser session and their local DICOM files will be deleted. The shared example study will remain.',
      confirmLabel: 'Clear session',
      onConfirm: async () => {
        setClearingSession(true)
        try {
          await clearTemporarySession()
          setStudies([])
          setActiveStudy(null)
          setActiveSeries(null)
          setSlices([])
          setSeriesSliceMap({})
          setNotice({ type: 'success', text: 'Temporary session cleared. A new empty session has started.' })
          await refresh()
        } catch (error) {
          setNotice({ type: 'error', text: error.message })
        } finally {
          setClearingSession(false)
        }
      },
    })
  }
  const cancelConfirmation = () => { if (!confirming) setConfirmation(null) }
  const runConfirmation = async () => {
    if (!confirmation || confirming) return
    setConfirming(true)
    try { await confirmation.onConfirm() } finally {
      setConfirming(false)
      setConfirmation(null)
    }
  }
  const focusedPlane = viewerTab === 'Sagittal' ? 'SAG' : viewerTab === 'Coronal' ? 'COR' : viewerTab === 'Axial' ? 'AX' : null
  const focusedSeries = focusedPlane ? planeSeries[focusedPlane] : null
  const focusedItems = seriesSliceMap[focusedSeries?.id] || []
  const focusedSlices = focusedSeries?.id === activeSeries?.id ? slices : focusedItems
  if (loading && !activeStudy) return <div className="loading-screen"><div className="brand-mark">KR</div><p>Loading local workspace…</p></div>

  const viewerContent = viewerTab === 'Overview' ? (
    <MprViewer series={activeSeries} />
  ) : viewerTab === 'Images / Series' ? (
    <SeriesBrowser study={activeStudy} activeSeriesId={activeSeries?.id} sliceMap={seriesSliceMap} onSelect={(series) => selectSeries(series, { switchToDirection: false })} />
  ) : (
    <FocusedViewer
      series={focusedSeries}
      slices={focusedSlices}
      currentIndex={currentIndex}
      onActiveSliceChange={setSliceIndex}
    />
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark">KR</div><div><h1>Knee Review</h1><span>Local DICOM workspace</span></div></div>
        <div className="top-actions"><SessionControls onClear={clearWorkspace} disabled={clearingSession || uploading} /><button className="button primary" onClick={() => fileInput.current?.click()} disabled={uploading}><UploadCloud size={16} /> Import study</button><input ref={fileInput} hidden type="file" accept=".dcm,.zip,application/dicom,application/zip" multiple onChange={upload} /><input ref={folderInput} hidden type="file" webkitdirectory="true" multiple onChange={upload} /></div>
      </header>

      {notice && notice.type !== 'analyze' && <div className={`notice ${notice.type}`}><span>{notice.type === 'error' ? <AlertCircle size={16} /> : <Info size={16} />}{notice.text}</span><button aria-label="Dismiss notice" onClick={() => setNotice(null)}><X size={15} /></button></div>}

      <div className="body-layout">
        <StudySidebar
          studies={studies}
          activeStudyId={activeStudy?.id}
          activeSeriesId={activeSeries?.id}
          expandedStudies={expandedStudies}
          expandedSeries={expandedSeries}
          uploading={uploading}
          uploadProgress={uploadProgress}
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
                <div><div className="title-row"><h2>{activeStudy.display_name}</h2><span className={`source-badge ${activeStudy.source}`}>{activeStudy.source === 'sample' ? 'Example' : 'Imported'}</span></div><p className="subline">{activeStudy.series.length} series · {activeStudy.total_slices} images · UID ending {activeStudy.study_uid.slice(-12)}</p></div>
                <div className="head-actions"><button className="button analyze-button" onClick={analyzeStudy}><Sparkles size={15} /> Analyze <span>Coming soon</span></button><button className="button ghost" onClick={() => deleteStudy(activeStudy)} disabled={activeStudy.source === 'sample'}><Trash2 size={15} /> Delete study</button></div>
              </div>

              {notice?.type === 'analyze' && <div className="notice analyze"><span><Info size={16} />{notice.text}</span><button aria-label="Dismiss notice" onClick={() => setNotice(null)}><X size={15} /></button></div>}

              <div className="viewer-shell">
                <section className="viewer-pane" aria-label="DICOM viewer">
                  <ViewerTabs tabs={tabs} activeTab={viewerTab} onChange={changeTab} />
                  <ViewerToolbar activeStudy={activeStudy} activeSeries={activeSeries} seriesLabel={viewerTab === 'Overview' ? 'MPR source' : 'Active series'} selectSeries={(series) => selectSeries(series, { switchToDirection: !['Overview', 'Images / Series'].includes(viewerTab) })} currentIndex={currentIndex} slices={slices} setSliceIndex={setSliceIndex} showZoom={false} showSlices={false} />
                  {viewerContent}
                  <div className="viewer-footer"><span><ImageIcon size={14} /> {viewerTab === 'Overview' ? `Synchronized MPR · ${activeSeries?.description || 'Select an active series'}` : currentSlice?.filename || 'Select a series to view images'}</span><span>Native DICOM · Research use only · Not validated for diagnosis</span></div>
                </section>
                <StudyInfoPanel study={activeStudy} />
              </div>
            </>
          )}
        </main>
      </div>
      <ConfirmationDialog confirmation={confirmation} busy={confirming || clearingSession} onCancel={cancelConfirmation} onConfirm={runConfirmation} />
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)

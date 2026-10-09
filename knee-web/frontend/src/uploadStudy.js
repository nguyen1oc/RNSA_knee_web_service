function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** unitIndex
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'less than a minute'
  const rounded = Math.ceil(seconds)
  const minutes = Math.floor(rounded / 60)
  const remainder = rounded % 60
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`
}

function errorMessage(payload, fallback) {
  const detail = payload?.detail
  if (typeof detail === 'string') return detail
  if (detail?.message) return detail.message
  if (detail) return JSON.stringify(detail)
  return fallback
}

function uploadDirectToCloudStorage(form, onProgress, startedAt) {
  const files = form.getAll('files')
  if (!files.length) return Promise.reject(new Error('Choose at least one .dcm file or ZIP archive.'))
  const total = files.reduce((sum, file) => sum + file.size, 0)
  let loadedBeforeCurrent = 0

  const updateProgress = (loaded) => {
    const loadedTotal = Math.min(total, loadedBeforeCurrent + loaded)
    const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.5)
    const bytesPerSecond = loadedTotal / elapsedSeconds
    const secondsRemaining = bytesPerSecond > 0 ? (total - loadedTotal) / bytesPerSecond : null
    onProgress({
      phase: loadedTotal >= total ? 'indexing' : 'uploading',
      loaded: loadedTotal,
      total,
      percent: Math.min(100, Math.round((loadedTotal / total) * 100)),
      eta: secondsRemaining === null ? null : formatDuration(secondsRemaining),
    })
  }

  const uploadOne = async (file) => {
    const response = await fetch(apiUrl('/api/uploads/resumable'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, size: file.size }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(errorMessage(payload, `Could not prepare ${file.name} for upload.`))

    const chunkBytes = 8 * 1024 * 1024
    let offset = 0
    while (offset < file.size) {
      const chunkEnd = Math.min(offset + chunkBytes, file.size) - 1
      const status = await new Promise((resolve, reject) => {
        const request = new XMLHttpRequest()
        request.open('PUT', payload.upload_url)
        request.setRequestHeader('Content-Type', payload.content_type)
        request.setRequestHeader('Content-Range', `bytes ${offset}-${chunkEnd}/${file.size}`)
        request.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) updateProgress(offset + event.loaded)
        })
        request.addEventListener('load', () => {
          if (request.status === 308) {
            const acknowledged = request.getResponseHeader('Range')?.match(/bytes=0-(\d+)/)
            resolve({ complete: false, nextOffset: acknowledged ? Number(acknowledged[1]) + 1 : chunkEnd + 1 })
          } else if (request.status >= 200 && request.status < 300) {
            resolve({ complete: true, nextOffset: file.size })
          } else {
            reject(new Error(`Cloud Storage upload failed for ${file.name} (HTTP ${request.status}).`))
          }
        })
        request.addEventListener('error', () => reject(new Error(`Network error uploading ${file.name} to Cloud Storage.`)))
        request.addEventListener('abort', () => reject(new Error('Upload was cancelled.')))
        request.send(file.slice(offset, chunkEnd + 1))
      })
      offset = status.nextOffset
      if (status.complete) break
    }
    const completionResponse = await fetch(apiUrl(`/api/uploads/${payload.upload_id}/complete`), {
      method: 'POST',
      credentials: 'include',
    })
    const completionPayload = await completionResponse.json().catch(() => ({}))
    if (!completionResponse.ok) {
      throw new Error(errorMessage(completionPayload, `Could not verify the upload for ${file.name}.`))
    }
    loadedBeforeCurrent += file.size
    updateProgress(0)
    return payload.upload_id
  }

  return (async () => {
    const uploadIds = []
    for (const file of files) uploadIds.push(await uploadOne(file))
    onProgress({ phase: 'indexing', loaded: total, total, percent: 100, eta: null })
    const response = await fetch(apiUrl('/api/studies/finalize-upload'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upload_ids: uploadIds }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(errorMessage(payload, 'The API could not validate and index this study.'))
    return payload
  })()
}

export function uploadStudy(form, onProgress, startedAt = Date.now()) {
  if (import.meta.env.VITE_DIRECT_GCS_UPLOAD === 'true') {
    return uploadDirectToCloudStorage(form, onProgress, startedAt)
  }
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', apiUrl('/api/studies/upload'))
    request.withCredentials = true

    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return
      const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.5)
      const bytesPerSecond = event.loaded / elapsedSeconds
      const secondsRemaining = bytesPerSecond > 0
        ? (event.total - event.loaded) / bytesPerSecond
        : null
      onProgress({
        phase: event.loaded >= event.total ? 'indexing' : 'uploading',
        loaded: event.loaded,
        total: event.total,
        percent: Math.min(100, Math.round((event.loaded / event.total) * 100)),
        eta: secondsRemaining === null ? null : formatDuration(secondsRemaining),
      })
    })

    request.addEventListener('load', () => {
      let payload = {}
      try { payload = JSON.parse(request.responseText || '{}') } catch { /* handled below */ }
      if (request.status < 200 || request.status >= 300) {
        const fallback = request.status === 404
          ? 'API endpoint not found. Deploy FastAPI and connect it to this website.'
          : request.status === 413
            ? 'The upload is larger than the current deployment accepts.'
            : request.statusText || `Upload failed (HTTP ${request.status}).`
        reject(new Error(errorMessage(payload, fallback)))
        return
      }
      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.study_ids)) {
        reject(new Error('The API returned an invalid upload response. Confirm the frontend is connected to FastAPI.'))
        return
      }
      resolve(payload)
    })

    request.addEventListener('error', () => {
      reject(new Error('Cannot reach the API backend. Confirm it is deployed and connected to this website.'))
    })
    request.addEventListener('abort', () => reject(new Error('Upload was cancelled.')))
    request.send(form)
  })
}

export { formatBytes }
import { apiUrl } from './api'

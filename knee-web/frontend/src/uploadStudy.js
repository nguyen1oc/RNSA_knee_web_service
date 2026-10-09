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

export function uploadStudy(form, onProgress, startedAt = Date.now()) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', '/api/studies/upload')

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

import { core, imageId, initializeImaging, uniqueId } from './runtime'

// Bounded decoding keeps the UI responsive and lets a tab change cancel the remaining work.
export async function loadVolume(seriesId, signal, progress) {
  const response = await fetch(`/api/series/${seriesId}/volume`, { signal })
  if (!response.ok) throw new Error('Unable to inspect volume geometry.')
  const geometry = await response.json()
  if (!geometry.eligible) throw new Error(geometry.reasons.join(' '))
  await initializeImaging()
  const imageIds = geometry.dicom_urls.map(imageId)
  let cursor = 0
  let completed = 0
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < imageIds.length) {
      signal.throwIfAborted()
      const id = imageIds[cursor++]
      await core.imageLoader.loadAndCacheImage(id)
      signal.throwIfAborted()
      progress(++completed, imageIds.length)
    }
  }))
  signal.throwIfAborted()
  const id = `cornerstoneStreamingImageVolume:${uniqueId('mpr')}`
  const volume = await core.volumeLoader.createAndCacheVolume(id, { imageIds })
  if (signal.aborted) { core.cache.removeVolumeLoadObject(id); signal.throwIfAborted() }
  volume.load()
  return { id, volume, geometry }
}

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'

const apiUrl = (__ENV.API_BASE_URL || '').replace(/\/$/, '')
const stagingOrigin = __ENV.STAGING_ORIGIN || ''
const gateToken = __ENV.KNEE_STAGING_GATE_TOKEN || ''
const vus = Number(__ENV.VUS || 1)
const iterationsPerVu = Number(__ENV.ITERATIONS_PER_VU || 1)

const volumeDuration = new Trend('volume_request_duration', true)
const volumeFailures = new Rate('volume_request_failures')
const dicomDuration = new Trend('dicom_first_slice_duration', true)
const dicomFailures = new Rate('dicom_first_slice_failures')

export const options = {
  vus,
  iterations: vus * iterationsPerVu,
  thresholds: {
    volume_request_failures: ['rate<0.01'],
    dicom_first_slice_failures: ['rate<0.01'],
  },
}

function protectedHeaders() {
  return {
    'x-knee-staging-gate': gateToken,
    Origin: stagingOrigin,
    Accept: 'application/json',
  }
}

export default function () {
  if (!/^https:\/\/knee-review-api-staging-[a-z0-9-]+\.a\.run\.app$/.test(apiUrl)) {
    throw new Error('Set API_BASE_URL to the Cloud Run staging API URL. Production and Vercel URLs are not allowed.')
  }
  if (!stagingOrigin || !gateToken) throw new Error('Set STAGING_ORIGIN and KNEE_STAGING_GATE_TOKEN before running k6.')

  const session = http.post(`${apiUrl}/api/sessions`, null, { headers: protectedHeaders() })
  const sessionOk = check(session, { 'staging session created': (response) => response.status === 200 })
  if (!sessionOk) {
    volumeFailures.add(true)
    return
  }

  const studies = http.get(`${apiUrl}/api/studies`, { headers: protectedHeaders() })
  let sample
  try {
    sample = studies.json().find((study) => study.source === 'sample')
  } catch {
    sample = null
  }
  const sampleOk = check(studies, {
    'sample study listed': (response) => response.status === 200 && Boolean(sample),
  })
  if (!sampleOk) {
    volumeFailures.add(true)
    return
  }

  const requestedPlane = (__ENV.PLANE || '').toUpperCase()
  const series = requestedPlane
    ? sample.series.find((item) => item.plane === requestedPlane && item.geometry_status === 'valid')
    : sample.series.find((item) => item.geometry_status === 'valid') || sample.series[0]
  if (!series) throw new Error(`The sample has no valid ${requestedPlane || 'volume'} series.`)
  const startedAt = Date.now()
  const volume = http.get(`${apiUrl}/api/series/${series.id}/volume`, { headers: protectedHeaders() })
  volumeDuration.add(Date.now() - startedAt)
  let volumePayload = null
  try { volumePayload = volume.json() } catch { /* reported in the check below */ }
  const volumeOk = check(volume, {
    'volume endpoint returns an eligible series': (response) => response.status === 200 && volumePayload?.series_id === series.id && volumePayload?.eligible === true,
  })
  volumeFailures.add(!volumeOk)

  if (volumeOk && volumePayload?.eligible && volumePayload.dicom_urls?.length) {
    const returnedDicomUrl = volumePayload.dicom_urls[0]
    const dicomUrl = /^https?:\/\//.test(returnedDicomUrl)
      ? returnedDicomUrl
      : `${apiUrl}${returnedDicomUrl.startsWith('/') ? '' : '/'}${returnedDicomUrl}`
    const dicomStartedAt = Date.now()
    const firstDicom = http.get(dicomUrl, {
      headers: volumePayload.dicom_delivery === 'gcs_signed_url' ? {} : protectedHeaders(),
    })
    dicomDuration.add(Date.now() - dicomStartedAt)
    const dicomOk = check(firstDicom, {
      'first volume DICOM responds successfully': (response) => response.status === 200 && response.body.length > 0,
    })
    dicomFailures.add(!dicomOk)
  }

  sleep(1)
}

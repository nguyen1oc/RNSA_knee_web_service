import { useEffect, useState } from 'react'
import { apiFetch } from '../api'
import './study-acquisition-details.css'

const scannerFields = [
  ['modality', 'Modality'],
  ['manufacturer', 'Manufacturer'],
  ['manufacturer_model', 'Scanner model'],
  ['field_strength_t', 'Magnetic field'],
]

const settingFields = [
  ['sequence_name', 'Sequence'],
  ['scanning_sequence', 'Scan type'],
  ['scan_options', 'Scan options'],
  ['repetition_time_ms', 'Repetition time'],
  ['echo_time_ms', 'Echo time'],
  ['slice_thickness_mm', 'Slice thickness'],
  ['spacing_between_slices_mm', 'Slice spacing'],
]

function displayValue(key, value) {
  if (value === null || value === undefined || value === '') return ''
  if (key === 'field_strength_t') return `${value} T`
  if (key.endsWith('_ms')) return `${value} ms`
  if (key.endsWith('_mm')) return `${value} mm`
  return String(value)
}

export default function StudyAcquisitionDetails({ studyId }) {
  const [data, setData] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    apiFetch(`/api/studies/${encodeURIComponent(studyId)}/acquisition`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Acquisition metadata unavailable')
        setData(await response.json())
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setData({ unavailable: true, scanner: {}, series: [] })
      })
    return () => controller.abort()
  }, [studyId])

  const scannerRows = scannerFields.filter(([key]) => data?.scanner?.[key]?.length)
  const seriesWithSettings = (data?.series || []).filter((series) =>
    settingFields.some(([key]) => series.settings?.[key] !== null && series.settings?.[key] !== undefined && series.settings?.[key] !== ''),
  )
  const hasMetadata = scannerRows.length > 0 || seriesWithSettings.length > 0

  return (
    <details className="acquisition-details">
      <summary>MRI acquisition</summary>
      {!data && <p className="acquisition-empty">Reading DICOM acquisition metadata…</p>}
      {data?.unavailable && <p className="acquisition-empty">Acquisition metadata is unavailable for this study.</p>}
      {data && !data.unavailable && !hasMetadata && (
        <p className="acquisition-empty">No scanner or sequence details were present in the source DICOM headers.</p>
      )}
      {scannerRows.length > 0 && (
        <dl className="acquisition-scanner">
          {scannerRows.map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{data.scanner[key].map((value) => displayValue(key, value)).join(' · ')}</dd>
            </div>
          ))}
        </dl>
      )}
      {seriesWithSettings.map((series) => (
        <section className="acquisition-series" key={series.id}>
          <h4><span>{series.description}</span><small>{series.plane}</small></h4>
          <dl>
            {settingFields.map(([key, label]) => {
              const value = displayValue(key, series.settings?.[key])
              return value ? <div key={key}><dt>{label}</dt><dd>{value}</dd></div> : null
            })}
          </dl>
        </section>
      ))}
    </details>
  )
}

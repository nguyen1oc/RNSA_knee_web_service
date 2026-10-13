const STORAGE_KEY = 'knee-review.analysis-results.v1'
const PANEL_KEY = 'knee-review.study-panel.v1'

export const analysisTargets = [
  { id: 'acl', name: 'ACL', translation: 'Dây chằng chéo trước' },
  { id: 'mcl', name: 'MCL', translation: 'Dây chằng bên trong' },
  { id: 'medial-meniscus', name: 'Medial meniscus', translation: 'Sụn chêm trong' },
  { id: 'lateral-meniscus', name: 'Lateral meniscus', translation: 'Sụn chêm ngoài' },
  { id: 'medial-oa', name: 'Medial OA', translation: 'Thoái hóa khớp khoang trong' },
  { id: 'lateral-oa', name: 'Lateral OA', translation: 'Thoái hóa khớp khoang ngoài' },
  { id: 'pf-oa', name: 'PF OA', translation: 'Thoái hóa khớp bánh chè–đùi' },
  { id: 'effusion', name: 'Effusion', translation: 'Tràn dịch khớp' },
  { id: 'synovitis', name: 'Synovitis', translation: 'Viêm màng hoạt dịch' },
  { id: 'bakers-cyst', name: "Baker's cyst", translation: 'Nang Baker' },
  { id: 'contusion', name: 'Contusion', translation: 'Dập xương' },
  { id: 'fracture', name: 'Fracture', translation: 'Gãy xương' },
]

export const ANALYSIS_SCORE_THRESHOLD = 0.5

export function groupAnalysisScores(scores = {}) {
  const ranked = analysisTargets.map((target, index) => {
    const raw = scores?.[target.id]
    const parsed = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '')
      ? Number(raw)
      : NaN
    const score = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null
    return { ...target, score, index }
  }).sort((a, b) => {
    if (a.score === null) return b.score === null ? a.index - b.index : 1
    if (b.score === null) return -1
    return b.score - a.score || a.index - b.index
  })

  return {
    atOrAboveThreshold: ranked.filter(({ score }) => score !== null && score >= ANALYSIS_SCORE_THRESHOLD),
    remaining: ranked.filter(({ score }) => score === null || score < ANALYSIS_SCORE_THRESHOLD),
  }
}

export function modelSignalLevel(score) {
  if (score === null || !Number.isFinite(score) || score < 0 || score > 1) {
    return { key: 'unavailable', label: 'Unavailable' }
  }
  if (score < 0.25) return { key: 'minimal', label: 'Minimal signal' }
  if (score < 0.5) return { key: 'low', label: 'Low signal' }
  if (score < 0.75) return { key: 'moderate', label: 'Moderate signal' }
  return { key: 'strong', label: 'Strong signal' }
}

function readSessionValue(key) {
  try {
    const value = window.sessionStorage.getItem(key)
    return value ? JSON.parse(value) : {}
  } catch {
    return {}
  }
}

export function loadAnalysisResults() {
  return readSessionValue(STORAGE_KEY)
}

export function loadStudyPanelModes() {
  return readSessionValue(PANEL_KEY)
}

export function saveAnalysisResults(results) {
  try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(results)) } catch { /* Storage may be disabled or full. */ }
}

export function saveStudyPanelModes(modes) {
  try { window.sessionStorage.setItem(PANEL_KEY, JSON.stringify(modes)) } catch { /* Storage may be disabled or full. */ }
}

export function removeStudyAnalysis(studyId, results, modes) {
  const nextResults = { ...results }
  const nextModes = { ...modes }
  delete nextResults[studyId]
  delete nextModes[studyId]
  return { results: nextResults, modes: nextModes }
}

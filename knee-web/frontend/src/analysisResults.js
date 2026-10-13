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

// Presentation bands for the model's positive-finding confidence score.
// The raw score remains in session data so display thresholds can change independently.
export const scoreBands = [
  { key: 'very-low', min: 0, max: 0.25, label: 'Very low confidence', translation: 'Độ tự tin rất thấp' },
  { key: 'low', min: 0.25, max: 0.5, label: 'Low confidence', translation: 'Độ tự tin thấp' },
  { key: 'moderate', min: 0.5, max: 0.75, label: 'Moderate confidence', translation: 'Độ tự tin trung bình' },
  { key: 'high', min: 0.75, max: 1.000001, label: 'High confidence', translation: 'Độ tự tin cao' },
]

export function getScoreBand(value) {
  const score = Number(value)
  if (!Number.isFinite(score)) return null
  const clamped = Math.max(0, Math.min(1, score))
  return scoreBands.find(({ min, max }) => clamped >= min && clamped < max) || scoreBands[scoreBands.length - 1]
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

export function createFallbackAnalysis() {
  return {
    status: 'model_unavailable',
    model: null,
    createdAt: new Date().toISOString(),
    scores: Object.fromEntries(analysisTargets.map(({ id }) => [id, 0])),
  }
}

export function removeStudyAnalysis(studyId, results, modes) {
  const nextResults = { ...results }
  const nextModes = { ...modes }
  delete nextResults[studyId]
  delete nextModes[studyId]
  return { results: nextResults, modes: nextModes }
}

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

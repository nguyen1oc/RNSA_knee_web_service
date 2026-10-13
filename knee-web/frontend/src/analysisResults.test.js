import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  analysisTargets,
  createFallbackAnalysis,
  loadAnalysisResults,
  removeStudyAnalysis,
  saveAnalysisResults,
} from './analysisResults.js'

const originalWindow = globalThis.window

function installSessionStorage() {
  const values = new Map()
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  }
}

afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window
  else globalThis.window = originalWindow
})

test('fallback output contains 12 zero-valued study targets and no model claim', () => {
  const result = createFallbackAnalysis()
  assert.equal(analysisTargets.length, 12)
  assert.equal(result.status, 'model_unavailable')
  assert.equal(result.model, null)
  assert.deepEqual(Object.keys(result.scores), analysisTargets.map(({ id }) => id))
  assert.ok(Object.values(result.scores).every((score) => score === 0))
})

test('analysis results remain keyed to their study in session storage', () => {
  installSessionStorage()
  const resultA = createFallbackAnalysis()
  const resultB = { ...createFallbackAnalysis(), scores: { acl: 0.4 } }
  saveAnalysisResults({ studyA: resultA, studyB: resultB })
  const stored = loadAnalysisResults()
  assert.deepEqual(stored.studyA, resultA)
  assert.equal(stored.studyB.scores.acl, 0.4)
})

test('deleting a study removes only its saved result and panel mode', () => {
  const cleaned = removeStudyAnalysis(
    'studyA',
    { studyA: { scores: {} }, studyB: { scores: {} } },
    { studyA: 'analysis', studyB: 'info' },
  )
  assert.deepEqual(Object.keys(cleaned.results), ['studyB'])
  assert.deepEqual(cleaned.modes, { studyB: 'info' })
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { analysisTargets, removeStudyAnalysis } from './analysisResults.js'

test('analysis result target order matches the 12 model outputs', () => {
  assert.deepEqual(analysisTargets.map(({ id }) => id), [
    'acl', 'mcl', 'medial-meniscus', 'lateral-meniscus', 'medial-oa', 'lateral-oa',
    'pf-oa', 'effusion', 'synovitis', 'bakers-cyst', 'contusion', 'fracture',
  ])
})

test('removing a study clears only that study result and panel mode', () => {
  const result = removeStudyAnalysis(
    'study-a',
    { 'study-a': { status: 'complete' }, 'study-b': { status: 'complete' } },
    { 'study-a': 'analysis', 'study-b': 'info' },
  )

  assert.deepEqual(result, {
    results: { 'study-b': { status: 'complete' } },
    modes: { 'study-b': 'info' },
  })
})

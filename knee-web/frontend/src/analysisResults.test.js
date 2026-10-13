import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analysisTargets,
  formatAnalysisScore,
  groupAnalysisScores,
  removeStudyAnalysis,
} from './analysisResults.js'

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

test('scores above 0.5 come first in descending order and the rest stay sorted', () => {
  const { aboveThreshold, remaining } = groupAnalysisScores({
    acl: 0.5,
    mcl: 0.93,
    'medial-meniscus': 0.71,
    'lateral-meniscus': 0.93,
    synovitis: 0.501,
    fracture: 0.2,
    effusion: null,
  })

  assert.deepEqual(aboveThreshold.map(({ id }) => id), [
    'mcl', 'lateral-meniscus', 'medial-meniscus', 'synovitis',
  ])
  assert.deepEqual(remaining.slice(0, 2).map(({ id }) => id), ['acl', 'fracture'])
  assert.equal(remaining.length, 8)
  assert.equal(remaining.find(({ id }) => id === 'effusion').score, null)
  assert.equal(formatAnalysisScore(aboveThreshold[0].score), '0.930')
})

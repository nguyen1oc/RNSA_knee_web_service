import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analysisTargets,
  modelSignalLevel,
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

test('scores at or above 0.5 come first in descending order and the rest stay sorted', () => {
  const { atOrAboveThreshold, remaining } = groupAnalysisScores({
    acl: 0.5,
    mcl: 0.93,
    'medial-meniscus': 0.71,
    'lateral-meniscus': 0.93,
    synovitis: 0.501,
    fracture: 0.2,
    effusion: null,
  })

  assert.deepEqual(atOrAboveThreshold.map(({ id }) => id), [
    'mcl', 'lateral-meniscus', 'medial-meniscus', 'synovitis', 'acl',
  ])
  assert.equal(remaining[0].id, 'fracture')
  assert.equal(remaining.length, 7)
  assert.equal(remaining.find(({ id }) => id === 'effusion').score, null)
  assert.deepEqual(modelSignalLevel(atOrAboveThreshold[0].score), { key: 'strong', label: 'Strong signal' })
})

test('model signal labels use inclusive lower bounds without claiming a probability', () => {
  const examples = [
    [0, 'minimal'], [0.249, 'minimal'],
    [0.25, 'low'], [0.499, 'low'],
    [0.5, 'moderate'], [0.749, 'moderate'],
    [0.75, 'strong'], [1, 'strong'],
  ]
  for (const [score, key] of examples) assert.equal(modelSignalLevel(score).key, key)
  assert.deepEqual(examples.map(([score]) => modelSignalLevel(score).label), [
    'Minimal signal', 'Minimal signal', 'Low signal', 'Low signal',
    'Moderate signal', 'Moderate signal', 'Strong signal', 'Strong signal',
  ])
  assert.equal(modelSignalLevel(null).label, 'Unavailable')
})

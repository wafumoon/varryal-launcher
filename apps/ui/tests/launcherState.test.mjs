import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyRemoteError,
  formatCharacterName,
  nextOptionalSelection,
  resolveMotionReduction,
} from '../.test-dist/utils/launcherState.js'

test('classifyRemoteError separates expired auth, credentials, network, and unknown failures', () => {
  assert.equal(classifyRemoteError('401 Unauthorized: token expired'), 'auth')
  assert.equal(classifyRemoteError('Неверная почта или пароль'), 'credentials')
  assert.equal(classifyRemoteError('Failed to fetch: network timeout'), 'network')
  assert.equal(classifyRemoteError('Unexpected bridge response'), 'unknown')
})

test('formatCharacterName prefers the in-world name and surname over generated nickname', () => {
  assert.equal(formatCharacterName({ name: 'Мира', surname: 'Ветрова', generatedNickname: 'Mira_9912' }), 'Мира Ветрова')
  assert.equal(formatCharacterName({ name: 'Мира', surname: null, generatedNickname: 'Mira_9912' }), 'Мира')
  assert.equal(formatCharacterName({ generatedNickname: 'Mira_9912' }), 'Mira_9912')
})

test('nextOptionalSelection toggles immutably while preserving stable order', () => {
  const original = ['VoiceChat', 'Iris']
  assert.deepEqual(nextOptionalSelection(original, 'Iris'), ['VoiceChat'])
  assert.deepEqual(nextOptionalSelection(original, 'ReplayMod'), ['VoiceChat', 'Iris', 'ReplayMod'])
  assert.deepEqual(original, ['VoiceChat', 'Iris'])
})

test('resolveMotionReduction supports system default and explicit overrides', () => {
  assert.equal(resolveMotionReduction('system', true), true)
  assert.equal(resolveMotionReduction('system', false), false)
  assert.equal(resolveMotionReduction('reduced', false), true)
  assert.equal(resolveMotionReduction('full', true), false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyRemoteError,
  formatCharacterName,
  nextOptionalSelection,
  resolveMotionReduction,
  isCurrentOperation,
  matchesReadyProfile,
  canAcknowledgeSettingsSave,
  dirtyAfterOptionalRollback,
  canRollbackOptionalSelection,
  resolveOptionalRevisionOnProfileLoad,
} from '../.test-dist/utils/launcherState.js'
import { createSerialQueue } from '../.test-dist/utils/serialQueue.js'
import { formatLauncherVersion } from '../.test-dist/utils/version.js'

const storageData = new Map()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: key => storageData.get(key) ?? null,
    setItem: (key, value) => storageData.set(key, String(value)),
    removeItem: key => storageData.delete(key),
    clear: () => storageData.clear(),
    key: index => [...storageData.keys()][index] ?? null,
    get length() { return storageData.size },
  },
})
const { useSettingsStore } = await import('../.test-dist/store/settings.js')

test('classifyRemoteError separates expired auth, credentials, network, and unknown failures', () => {
  assert.equal(classifyRemoteError('401 Unauthorized: token expired'), 'auth')
  assert.equal(classifyRemoteError('Неверная почта или пароль'), 'credentials')
  assert.equal(classifyRemoteError('Failed to fetch: network timeout'), 'network')
  assert.equal(classifyRemoteError('Unexpected bridge response'), 'unknown')
})

test('launcher version label is compact and avoids a duplicate v prefix', () => {
  assert.equal(formatLauncherVersion('1.0.10'), 'v1.0.10')
  assert.equal(formatLauncherVersion('v1.0.10'), 'v1.0.10')
  assert.equal(formatLauncherVersion('  '), null)
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

test('operation epochs reject continuations invalidated by logout or retry', () => {
  assert.equal(isCurrentOperation(4, 4), true)
  assert.equal(isCurrentOperation(4, 5), false)
})

test('download and run events only match the active ready profile', () => {
  assert.equal(matchesReadyProfile({ readyProfileId: 'current' }, 'current'), true)
  assert.equal(matchesReadyProfile({ readyProfileId: 'previous' }, 'current'), false)
  assert.equal(matchesReadyProfile({ readyProfileId: 'current' }, null), false)
  assert.equal(matchesReadyProfile({}, 'current'), false)
})

test('settings saves acknowledge only the exact profile revision they persisted', () => {
  assert.equal(canAcknowledgeSettingsSave('profile-a', 8, 'profile-a', 8), true)
  assert.equal(canAcknowledgeSettingsSave('profile-a', 8, 'profile-a', 9), false)
  assert.equal(canAcknowledgeSettingsSave('profile-a', 8, 'profile-b', 8), false)
})

test('optional rollback restores the dirty baseline and preserves newer edits', () => {
  assert.equal(dirtyAfterOptionalRollback(8, 8, true, false), false)
  assert.equal(dirtyAfterOptionalRollback(8, 8, true, true), true)
  assert.equal(dirtyAfterOptionalRollback(8, 9, true, false), true)
  assert.equal(dirtyAfterOptionalRollback(8, 9, false, true), false)
})

test('optional rollback cannot overwrite a newer optional selection', () => {
  assert.equal(canRollbackOptionalSelection(8, 8), true)
  assert.equal(canRollbackOptionalSelection(8, 9), false)
})

test('profile remount preserves an active optional revision', () => {
  assert.equal(resolveOptionalRevisionOnProfileLoad(undefined, 8), 8)
  assert.equal(resolveOptionalRevisionOnProfileLoad(7, 8), 7)
})

function resetSettingsStore() {
  useSettingsStore.setState({
    profileSettings: { profileUuid: 'profile-a', enabledOptionals: [] },
    dirty: false,
    revision: 0,
    optionalsByProfile: {},
    optionalsRevisionByProfile: {},
  })
}

test('stale optional failure cannot clobber a newer selection after remount', () => {
  resetSettingsStore()
  useSettingsStore.getState().setOptionals(['A'], true)
  const failedRevision = useSettingsStore.getState().revision

  useSettingsStore.getState().setProfileSettings({ profileUuid: 'profile-a', enabledOptionals: [] })
  useSettingsStore.getState().setOptionals(['A', 'B'], true)
  useSettingsStore.getState().rollbackOptionals('profile-a', [], failedRevision, false)

  const state = useSettingsStore.getState()
  assert.deepEqual(state.profileSettings.enabledOptionals, ['A', 'B'])
  assert.deepEqual(state.optionalsByProfile['profile-a'], ['A', 'B'])
  assert.equal(state.dirty, true)
})

test('failed optional save still rolls back through remount without a newer selection', () => {
  resetSettingsStore()
  useSettingsStore.getState().setOptionals(['A'], true)
  const failedRevision = useSettingsStore.getState().revision

  useSettingsStore.getState().setProfileSettings({ profileUuid: 'profile-a', enabledOptionals: [] })
  useSettingsStore.getState().rollbackOptionals('profile-a', [], failedRevision, false)

  const state = useSettingsStore.getState()
  assert.deepEqual(state.profileSettings.enabledOptionals, [])
  assert.deepEqual(state.optionalsByProfile['profile-a'], [])
  assert.equal(state.dirty, false)
})

test('later full save adopts optionals and invalidates an older rollback', () => {
  resetSettingsStore()
  useSettingsStore.getState().setOptionals(['A'], true)
  const failedOptionalRevision = useSettingsStore.getState().revision

  useSettingsStore.getState().adoptCurrentOptionalsForSave('profile-a')
  const fullSaveRevision = useSettingsStore.getState().revision
  useSettingsStore.getState().rollbackOptionals('profile-a', [], failedOptionalRevision, false)

  let state = useSettingsStore.getState()
  assert.deepEqual(state.profileSettings.enabledOptionals, ['A'])
  assert.deepEqual(state.optionalsByProfile['profile-a'], ['A'])
  assert.equal(state.dirty, true)

  useSettingsStore.getState().markClean('profile-a', fullSaveRevision)
  state = useSettingsStore.getState()
  assert.equal(state.dirty, false)
})

test('serial queue never overlaps bridge-session mutations', async () => {
  const queue = createSerialQueue()
  const order = []
  let releaseFirst
  const firstGate = new Promise(resolve => { releaseFirst = resolve })

  const first = queue.enqueue(async () => {
    order.push('first:start')
    await firstGate
    order.push('first:end')
  })
  const second = queue.enqueue(async () => {
    order.push('second:start')
    order.push('second:end')
  })

  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(order, ['first:start'])
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(order, ['first:start', 'first:end', 'second:start', 'second:end'])
})

test('serial queue recovers after a rejected operation', async () => {
  const queue = createSerialQueue()
  await assert.rejects(queue.enqueue(async () => { throw new Error('bridge failed') }), /bridge failed/)
  assert.equal(await queue.enqueue(async () => 'next operation ran'), 'next operation ran')
})

export type RemoteErrorKind = 'auth' | 'credentials' | 'network' | 'unknown'
export type MotionMode = 'system' | 'full' | 'reduced'

export interface CharacterIdentity {
  generatedNickname: string
  name?: string
  surname?: string | null
}

export function classifyRemoteError(error: unknown): RemoteErrorKind {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const normalized = message.toLocaleLowerCase('ru-RU')

  if (/неверн\S*\s+(почт\S*|email|парол\S*)|invalid credentials|wrong password|email or password/.test(normalized)) {
    return 'credentials'
  }
  if (/\b401\b|unauthori[sz]ed|token.{0,20}expired|expired.{0,20}token|invalid token|session.{0,20}expired|сесси\S*.{0,20}(истек|недейств)|токен.{0,20}(истек|недейств)/.test(normalized)) {
    return 'auth'
  }
  if (/network|failed to fetch|fetch failed|timeout|timed out|connection|connect failed|socket|\bdns\b|offline|сервер.{0,20}недоступ|сет\S*.{0,20}ошиб|соединени\S*.{0,20}(нет|сброш|прерван)/.test(normalized)) {
    return 'network'
  }
  return 'unknown'
}

export function formatCharacterName(character: CharacterIdentity): string {
  const parts = [character.name?.trim(), character.surname?.trim()].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : character.generatedNickname
}

export function nextOptionalSelection(enabled: readonly string[], name: string): string[] {
  return enabled.includes(name)
    ? enabled.filter(item => item !== name)
    : [...enabled, name]
}

export function resolveMotionReduction(mode: MotionMode, systemReduced: boolean): boolean {
  if (mode === 'reduced') return true
  if (mode === 'full') return false
  return systemReduced
}

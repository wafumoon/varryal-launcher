export function formatLauncherVersion(version: string): string | null {
  const normalized = version.trim()
  if (!normalized) return null
  return normalized.charAt(0).toLowerCase() === 'v' ? normalized : `v${normalized}`
}

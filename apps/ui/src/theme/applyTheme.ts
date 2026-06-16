import defaultTheme from './theme.json'

export interface Theme {
  name: string
  colors: Record<string, string>
  font: { ui: string; display?: string; mono: string }
  radius: { control: number; card: number; modal: number }
}

function camelToKebab(s: string) {
  return s.replace(/([A-Z])/g, '-$1').toLowerCase()
}

export function applyTheme(theme: Theme = defaultTheme as Theme) {
  const root = document.documentElement
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--${camelToKebab(key)}`, value as string)
  }
  root.style.setProperty('--font-ui', theme.font.ui)
  if (theme.font.display) root.style.setProperty('--font-display', theme.font.display)
  root.style.setProperty('--font-mono', theme.font.mono)
  root.style.setProperty('--radius-control', `${theme.radius.control}px`)
  root.style.setProperty('--radius-card', `${theme.radius.card}px`)
  root.style.setProperty('--radius-modal', `${theme.radius.modal}px`)
}

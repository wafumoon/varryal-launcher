import { useEffect, useState } from 'react'
import { X, Minus } from 'lucide-react'
import { formatLauncherVersion } from '../utils/version'

async function getTauriWindow() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    return getCurrentWindow()
  } catch {
    return null
  }
}

export function Titlebar({ title = 'Varryal Launcher' }: { title?: string }) {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    void import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then(value => {
        if (mounted) setVersion(formatLauncherVersion(value))
      })
      .catch(() => {
        if (mounted) setVersion(null)
      })
    return () => { mounted = false }
  }, [])

  async function minimize() {
    const win = await getTauriWindow()
    await win?.minimize()
  }

  async function close() {
    const win = await getTauriWindow()
    await win?.close()
  }

  return (
    <header className="vy-titlebar" data-tauri-drag-region>
      <div className="vy-titlebar__brand" data-tauri-drag-region>
        <span className="vy-titlebar__mark" aria-hidden="true" />
        <span>{title}</span>
        {version && (
          <span className="vy-titlebar__version" aria-label={`Версия лаунчера ${version}`}>
            {version}
          </span>
        )}
      </div>
      <div className="vy-titlebar__controls">
        <button className="vy-window-button" onClick={minimize} title="Свернуть" aria-label="Свернуть">
          <Minus size={13} />
        </button>
        <button className="vy-window-button vy-window-button--close" onClick={close} title="Закрыть" aria-label="Закрыть">
          <X size={13} />
        </button>
      </div>
    </header>
  )
}

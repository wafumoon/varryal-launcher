import { X, Minus } from 'lucide-react'

async function getTauriWindow() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    return getCurrentWindow()
  } catch {
    return null
  }
}

export function Titlebar({ title = 'Varryal Launcher' }: { title?: string }) {
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

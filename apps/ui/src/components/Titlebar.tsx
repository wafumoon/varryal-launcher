import { X, Minus } from 'lucide-react'

// Lazily import the Tauri window API so the UI still builds and runs in a
// plain browser / dev-mode without Tauri (calls are no-ops when the module is
// absent — e.g. during `pnpm build` Gate C which has no Tauri runtime).
async function getTauriWindow() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    return getCurrentWindow()
  } catch {
    return null
  }
}

// Detect macOS for button placement (left vs. right)
function isMac(): boolean {
  if (typeof navigator !== 'undefined') return navigator.platform.startsWith('Mac')
  return false
}

interface TitlebarProps {
  title?: string
}

export function Titlebar({ title = 'Varryal Launcher' }: TitlebarProps) {
  const mac = isMac()

  async function minimize() {
    const win = await getTauriWindow()
    await win?.minimize()
  }

  async function close() {
    const win = await getTauriWindow()
    await win?.close()
  }

  const buttons = (
    <div style={{ display: 'flex', gap: 8 }}>
      <WinBtn onClick={minimize} title="Minimise"><Minus size={11} /></WinBtn>
      <WinBtn onClick={close} title="Close" danger><X size={11} /></WinBtn>
    </div>
  )

  return (
    <div
      data-tauri-drag-region
      style={{
        height: 40,
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        background: 'var(--bg-elev-1)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {mac && <div style={{ marginRight: 'auto' }}>{buttons}</div>}
      <span
        style={{
          flex: 1,
          textAlign: mac ? 'center' : 'left',
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--text-mid)',
          pointerEvents: 'none',
        }}
      >
        {title}
      </span>
      {!mac && <div style={{ marginLeft: 'auto' }}>{buttons}</div>}
    </div>
  )
}

function WinBtn({
  onClick,
  children,
  title,
  danger,
}: {
  onClick: () => void
  children: React.ReactNode
  title: string
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 28,
        height: 28,
        borderRadius: 'var(--radius-control)',
        background: 'transparent',
        color: 'var(--text-mid)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.15s, color 0.15s',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLButtonElement
        el.style.background = danger ? 'var(--error)' : 'var(--bg-elev-3)'
        el.style.color = danger ? '#fff' : 'var(--text-hi)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLButtonElement
        el.style.background = 'transparent'
        el.style.color = 'var(--text-mid)'
      }}
    >
      {children}
    </button>
  )
}

import { useEffect, useRef } from 'react'

/**
 * Ambient drifting motes (gold + rune-teal) that float gently upward — a subtle
 * "living embers" layer over the hero backdrop. Pure 2D canvas, ~46 particles,
 * pointer-events none. Sits behind the app content (z-index 0).
 */
export function ParticleField() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let w = 0, h = 0
    const resize = () => {
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    type P = { x: number; y: number; r: number; vy: number; vx: number; a: number; gold: boolean; tw: number }
    const N = 46
    const parts: P[] = Array.from({ length: N }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.6 + Math.random() * 1.9,
      vy: 0.08 + Math.random() * 0.34,
      vx: (Math.random() - 0.5) * 0.16,
      a: 0.08 + Math.random() * 0.4,
      gold: Math.random() < 0.72,
      tw: Math.random() * Math.PI * 2,
    }))

    let raf = 0
    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      for (const p of parts) {
        p.y -= p.vy
        p.x += p.vx
        p.tw += 0.03
        if (p.y < -6) { p.y = h + 6; p.x = Math.random() * w }
        if (p.x < -6) p.x = w + 6
        else if (p.x > w + 6) p.x = -6
        const col = p.gold ? '240,201,130' : '101,212,223'
        const alpha = p.a * (0.6 + 0.4 * Math.sin(p.tw))
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${col},${alpha})`
        ctx.shadowBlur = 6
        ctx.shadowColor = `rgba(${col},${alpha})`
        ctx.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={ref}
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}
    />
  )
}

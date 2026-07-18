import { useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../store/settings'
import { resolveMotionReduction } from '../utils/launcherState'

export function ParticleField({ variant }: { variant: 'arrival' | 'home' | 'plain' }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const motionMode = useSettingsStore(s => s.motionMode)
  const [systemReduced, setSystemReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const reduced = resolveMotionReduction(motionMode, systemReduced)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setSystemReduced(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || reduced || variant === 'plain') return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let width = 0
    let height = 0
    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    type Rain = { x: number; y: number; length: number; speed: number; opacity: number }
    type Ember = { x: number; y: number; size: number; speed: number; drift: number; opacity: number; phase: number }
    const rainCount = variant === 'arrival' ? 52 : 34
    const rains: Rain[] = Array.from({ length: rainCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      length: 10 + Math.random() * 22,
      speed: 2.3 + Math.random() * 2.8,
      opacity: 0.04 + Math.random() * 0.11,
    }))
    const embers: Ember[] = Array.from({ length: variant === 'home' ? 13 : 5 }, () => ({
      x: width * (0.64 + Math.random() * 0.3),
      y: height * (0.2 + Math.random() * 0.68),
      size: 0.5 + Math.random() * 1.2,
      speed: 0.05 + Math.random() * 0.13,
      drift: (Math.random() - 0.5) * 0.08,
      opacity: 0.06 + Math.random() * 0.18,
      phase: Math.random() * Math.PI * 2,
    }))

    let raf = 0
    const draw = () => {
      ctx.clearRect(0, 0, width, height)
      ctx.lineWidth = 0.7
      for (const rain of rains) {
        rain.y += rain.speed
        rain.x -= rain.speed * 0.18
        if (rain.y > height + rain.length || rain.x < -rain.length) {
          rain.y = -rain.length
          rain.x = Math.random() * width + width * 0.12
        }
        ctx.strokeStyle = `rgba(210,218,216,${rain.opacity})`
        ctx.beginPath()
        ctx.moveTo(rain.x, rain.y)
        ctx.lineTo(rain.x - rain.length * 0.18, rain.y + rain.length)
        ctx.stroke()
      }
      for (const ember of embers) {
        ember.y -= ember.speed
        ember.x += ember.drift
        ember.phase += 0.018
        if (ember.y < height * 0.1) ember.y = height * 0.9
        const alpha = ember.opacity * (0.72 + Math.sin(ember.phase) * 0.28)
        ctx.fillStyle = `rgba(221,179,107,${alpha})`
        ctx.beginPath()
        ctx.arc(ember.x, ember.y, ember.size, 0, Math.PI * 2)
        ctx.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      ctx.clearRect(0, 0, width, height)
    }
  }, [reduced, variant])

  return <canvas ref={ref} className="vy-atmosphere" aria-hidden="true" />
}

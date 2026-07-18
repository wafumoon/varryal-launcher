import { useEffect, useRef, useState } from 'react'
import { SkinViewer, IdleAnimation } from 'skinview3d'
import { useSettingsStore } from '../store/settings'
import { resolveMotionReduction } from '../utils/launcherState'

interface SkinPreviewProps {
  skin: string
  model?: 'classic' | 'slim'
  width?: number
  height?: number
}

export function SkinPreview({ skin, model = 'classic', width = 230, height = 330 }: SkinPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<SkinViewer | null>(null)
  const pointerInside = useRef(false)
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
    const canvas = canvasRef.current
    if (!canvas) return
    const viewer = new SkinViewer({ canvas, width, height })
    viewer.fov = 36
    viewer.zoom = 0.8
    viewer.controls.enableZoom = false
    viewer.controls.enablePan = false
    viewer.autoRotateSpeed = 0.42
    viewerRef.current = viewer
    return () => {
      viewer.dispose()
      viewerRef.current = null
    }
  }, [width, height])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    viewer.animation = reduced ? null : new IdleAnimation()
    viewer.autoRotate = !reduced && !pointerInside.current
  }, [reduced])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !skin) return
    viewer.loadSkin(skin, { model: model === 'slim' ? 'slim' : 'default' }).catch(() => {})
  }, [skin, model])

  const pauseRotation = () => {
    pointerInside.current = true
    if (viewerRef.current) viewerRef.current.autoRotate = false
  }
  const resumeRotation = () => {
    pointerInside.current = false
    if (viewerRef.current) viewerRef.current.autoRotate = !reduced
  }

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="vy-skin-canvas"
      style={{ width, height }}
      onPointerEnter={pauseRotation}
      onPointerDown={pauseRotation}
      onPointerUp={pauseRotation}
      onPointerLeave={resumeRotation}
      aria-label="3D character preview"
    />
  )
}

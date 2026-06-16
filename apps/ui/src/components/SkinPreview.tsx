import { useEffect, useRef } from 'react'
import { SkinViewer, IdleAnimation } from 'skinview3d'

interface SkinPreviewProps {
  /** Skin source — a data: URL (from portal_fetch_skin) or a same-origin path. */
  skin: string
  model?: 'classic' | 'slim'
  width?: number
  height?: number
}

/**
 * Renders a Minecraft skin in 3D (skinview3d / WebGL) with a gentle idle pose and
 * auto-rotation; the user can drag to spin the model. One live viewer per mount —
 * keep this to the focused character only (browsers cap WebGL contexts).
 */
export function SkinPreview({ skin, model = 'classic', width = 230, height = 330 }: SkinPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<SkinViewer | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const viewer = new SkinViewer({ canvas, width, height })
    viewer.animation = new IdleAnimation()
    viewer.autoRotate = true
    viewer.autoRotateSpeed = 0.5
    viewer.fov = 38
    viewer.zoom = 0.82
    viewer.controls.enableZoom = false
    viewer.controls.enablePan = false
    viewerRef.current = viewer
    return () => {
      viewer.dispose()
      viewerRef.current = null
    }
  }, [width, height])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !skin) return
    viewer.loadSkin(skin, { model: model === 'slim' ? 'slim' : 'default' }).catch(() => {})
  }, [skin, model])

  return <canvas ref={canvasRef} style={{ width, height, display: 'block', cursor: 'grab' }} />
}

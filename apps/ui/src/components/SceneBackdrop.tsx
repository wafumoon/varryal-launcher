type SceneBackdropProps = {
  variant: 'arrival' | 'home' | 'plain'
}

export function SceneBackdrop({ variant }: SceneBackdropProps) {
  return (
    <div className={`vy-backdrop vy-backdrop--${variant}`} aria-hidden="true">
      <div className="vy-backdrop__image" />
      <div className="vy-backdrop__weather" />
      <div className="vy-backdrop__vignette" />
      <div className="vy-backdrop__grain" />
    </div>
  )
}

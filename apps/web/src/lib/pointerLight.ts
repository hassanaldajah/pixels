/**
 * The interface is lit by the pointer: panels get a soft blue glow that follows the mouse.
 * One listener writes two CSS variables per frame; the glow itself is pure CSS (see app.css).
 * It switches off by itself when the frame monitor reports a slow canvas (`.fx-reduced`).
 */
export function installPointerLight(): () => void {
  const root = document.documentElement
  let frame = 0
  let x = 0
  let y = 0
  const apply = () => {
    frame = 0
    root.style.setProperty('--mx', `${x}px`)
    root.style.setProperty('--my', `${y}px`)
  }
  const move = (e: PointerEvent) => {
    x = e.clientX
    y = e.clientY
    if (!frame) frame = requestAnimationFrame(apply)
  }
  window.addEventListener('pointermove', move, { passive: true })
  return () => {
    window.removeEventListener('pointermove', move)
    cancelAnimationFrame(frame)
  }
}

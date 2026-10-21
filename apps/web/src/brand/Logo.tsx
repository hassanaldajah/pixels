import { wordmark } from './wordmark.generated'

/** The "pixels" wordmark, traced from the supplied logo. Colour follows the theme tokens. */
export function Wordmark({
  height = 22,
  glow = true,
  className,
}: {
  height?: number
  glow?: boolean
  className?: string
}) {
  const width = (height * wordmark.width) / wordmark.height
  return (
    <svg
      role="img"
      aria-label="pixels"
      width={width}
      height={height}
      viewBox={`0 0 ${wordmark.width} ${wordmark.height}`}
      className={`wordmark ${glow ? 'wordmark-glow' : ''} ${className ?? ''}`}
    >
      <path d={wordmark.d} fill="var(--px-accent)" fillRule="evenodd" />
    </svg>
  )
}

/** The app icon (upright Apple-style squircle with the "p"). */
export function AppIcon({ size = 36 }: { size?: number }) {
  return (
    <img
      src="/icon-small.svg"
      width={size}
      height={size}
      alt="pixels"
      draggable={false}
      className="app-icon"
    />
  )
}

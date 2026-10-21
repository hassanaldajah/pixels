import gsap from 'gsap'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { wordmark } from './wordmark.generated'

/**
 * Full-screen opening animation.
 *
 *  1. A blue light is born under the "p" and the word grows out of it, tilted in 3D.
 *  2. The word settles flat, then a soft diagonal band of blue light glides across the letters. It is
 *     clipped to the letter shapes, so it reads as light moving over metal, not as a bar on top.
 *  3. A last glow pulse, then the workspace appears.
 *
 * The letters have real depth: a stack of darker copies behind the face makes the extrusion.
 */
const PAD = 90
const W = wordmark.width
const H = wordmark.height
const P_RIGHT = 322 // the "p" ends here; the "i" starts at ~336 (word coordinates)
const P_STEM_X = 50 // x of the p's descender, where the light is born
const DEPTH_LAYERS = 6
const DEPTH_STEP = 3
/** Whatever the computer manages, the intro never stays longer than this. */
const HARD_LIMIT_MS = 6000
const SKEW = -22

export function Splash({ onDone, onReveal }: { onDone: () => void; onReveal?: () => void }) {
  const reveal$ = useRef(onReveal)
  reveal$.current = onReveal
  const root = useRef<HTMLDivElement>(null)
  const reveal = useRef<SVGRectElement>(null)
  const sheen = useRef<SVGGElement>(null)
  const spark = useRef<SVGCircleElement>(null)
  const finished = useRef(false)

  const finish = useRef(() => {
    if (finished.current) return
    finished.current = true
    onDone()
  })

  useEffect(() => {
    const skip = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish.current()
    }
    window.addEventListener('keydown', skip)
    return () => window.removeEventListener('keydown', skip)
  }, [])

  useLayoutEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const clip = reveal.current
    const band = sheen.current
    const dot = spark.current
    if (!clip || !band || !dot || !root.current) return

    const state = { rise: 0, edge: P_RIGHT, band: -0.35 }
    const paint = () => {
      const top = H + PAD - state.rise * (H + PAD * 2)
      clip.setAttribute('x', String(-PAD))
      clip.setAttribute('y', String(top))
      clip.setAttribute('width', String(state.edge + PAD))
      clip.setAttribute('height', String(H + PAD * 2))
      dot.setAttribute('cy', String(Math.max(-PAD, top)))
      const x = state.band * (W + 260) - 130
      band.setAttribute('transform', `translate(${x.toFixed(1)} 0) skewX(${SKEW})`)
    }

    if (reduced) {
      state.rise = 1
      state.edge = W + PAD
      state.band = 2
      paint()
      dot.setAttribute('opacity', '0')
      reveal$.current?.()
      const timer = window.setTimeout(() => finish.current(), 600)
      return () => window.clearTimeout(timer)
    }

    // Follow the clock, not the frame rate: on a slow machine frames drop, but the intro still ends on time.
    gsap.ticker.lagSmoothing(0)
    const failsafe = window.setTimeout(() => finish.current(), HARD_LIMIT_MS)
    const ctx = gsap.context(() => {
      const timeline = gsap
        .timeline({ onUpdate: paint, onComplete: () => finish.current() })
        // fade in from black, the same background the desktop loading page shows: no visible seam
        .fromTo(root.current, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out' }, 0)
        .fromTo(
          '.splash-glow',
          { opacity: 0, scale: 0.7 },
          { opacity: 1, scale: 1, duration: 0.8, ease: 'power2.out' },
          0,
        )
        // the word starts tilted and far away, and settles flat
        .fromTo(
          '.splash-word',
          { rotateY: -24, rotateX: 12, scale: 0.8, y: 30, transformPerspective: 1400 },
          {
            rotateY: 0,
            rotateX: 0,
            scale: 1,
            y: 0,
            duration: 1.3,
            ease: 'power3.out',
            transformPerspective: 1400,
          },
          0,
        )
        // 1. light is born under the "p" and the word grows out of it
        .fromTo(dot, { opacity: 0 }, { opacity: 1, duration: 0.15 }, 0.05)
        .to(state, { rise: 1, duration: 0.6, ease: 'power2.out' }, 0.1)
        .to(state, { edge: W + PAD, duration: 0.65, ease: 'power2.inOut' }, 0.55)
        .to(dot, { opacity: 0, duration: 0.3 }, 0.7)
        // 2. the word settles, then one soft band of light glides across the letters
        .to(state, { band: 1.15, duration: 0.8, ease: 'sine.inOut' }, 0.85)
        // exit: the word keeps moving toward the viewer and dissolves while the app glides in underneath
        .call(() => reveal$.current?.(), [], 1.6)
        .to('.splash-word', { scale: 1.4, opacity: 0, duration: 0.55, ease: 'power3.in' }, 1.6)
        .to('.splash-glow', { opacity: 0, scale: 1.4, duration: 0.55, ease: 'power2.in' }, 1.6)
        .to(root.current, { opacity: 0, duration: 0.35, ease: 'power2.inOut' }, 1.8)
      // Test hook (only with pixels.e2e on): freeze the animation at a chosen second to inspect a frame.
      const seek = Number(sessionStorage.getItem('pixels.splash.seek'))
      if (localStorage.getItem('pixels.e2e') === '1' && Number.isFinite(seek) && seek > 0) {
        timeline.pause().seek(seek)
        paint()
      }
    }, root)
    return () => {
      window.clearTimeout(failsafe)
      gsap.ticker.lagSmoothing(500, 33)
      ctx.revert()
    }
  }, [])

  return (
    <div ref={root} className="splash" role="presentation" onClick={() => finish.current()}>
      <div className="splash-glow" />
      <svg
        className="splash-word"
        viewBox={`${-PAD} ${-PAD} ${W + PAD * 2} ${H + PAD * 2}`}
        aria-label="pixels"
      >
        <defs>
          <path id="splash-wm" d={wordmark.d} fillRule="evenodd" clipRule="evenodd" />
          <clipPath id="splash-reveal">
            <rect ref={reveal} x={-PAD} y={H + PAD} width={P_RIGHT + PAD} height={H + PAD * 2} />
          </clipPath>
          <mask
            id="splash-letters"
            maskUnits="userSpaceOnUse"
            x={-PAD}
            y={-PAD}
            width={W + PAD * 2}
            height={H + PAD * 2}
          >
            <use href="#splash-wm" fill="white" />
          </mask>
          <linearGradient id="splash-face" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--px-accent-soft)" />
            <stop offset="0.45" stopColor="var(--px-accent)" />
            <stop offset="1" stopColor="var(--px-accent-deep)" />
          </linearGradient>
          <linearGradient id="splash-edge" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--px-accent-deep)" />
            <stop offset="1" stopColor="var(--px-bg2)" />
          </linearGradient>
          <linearGradient id="splash-band" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="var(--px-accent-soft)" stopOpacity="0" />
            <stop offset="0.42" stopColor="var(--px-accent-soft)" stopOpacity="0.75" />
            <stop offset="0.5" stopColor="var(--px-text1)" stopOpacity="1" />
            <stop offset="0.58" stopColor="var(--px-accent-soft)" stopOpacity="0.75" />
            <stop offset="1" stopColor="var(--px-accent-soft)" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="splash-spark">
            <stop offset="0" stopColor="var(--px-text1)" />
            <stop offset="0.35" stopColor="var(--px-accent-soft)" stopOpacity="0.8" />
            <stop offset="1" stopColor="var(--px-accent)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g clipPath="url(#splash-reveal)">
          {/* the extrusion: darker copies stepping back and down */}
          {Array.from({ length: DEPTH_LAYERS }, (_, i) => DEPTH_LAYERS - i).map((n) => (
            <use
              key={n}
              href="#splash-wm"
              fill="url(#splash-edge)"
              transform={`translate(${n * DEPTH_STEP * 0.7} ${n * DEPTH_STEP})`}
            />
          ))}
          {/* the lit face */}
          <use href="#splash-wm" fill="url(#splash-face)" />
        </g>
        {/* one soft band of light, visible only on the letters */}
        <g mask="url(#splash-letters)">
          <g ref={sheen}>
            <rect
              x={-130}
              y={-PAD}
              width={260}
              height={H + PAD * 2}
              fill="url(#splash-band)"
              opacity="0.55"
            />
          </g>
        </g>
        <circle ref={spark} cx={P_STEM_X} cy={H + PAD} r="46" fill="url(#splash-spark)" opacity="0" />
      </svg>
      <div className="splash-hint">Click or press Esc to skip</div>
    </div>
  )
}

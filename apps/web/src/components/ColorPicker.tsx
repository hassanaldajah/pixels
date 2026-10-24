import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useLang, useT } from '../i18n'
import {
  hsvToRgb,
  paletteGrid,
  parseColor,
  rgbToHsv,
  searchNamed,
  toHex,
  type Hsv,
  type NamedColour,
} from '../lib/colorMath'
import '../styles/color.css'
import { Icon } from './Icon'

// ---------------------------------------------------------------------------------- recent colours
const RECENT_KEY = 'pixels.recentColours'
const MAX_RECENT = 16
let recent: string[] = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(saved)
      ? saved.filter((c): c is string => typeof c === 'string' && !!parseColor(c))
      : []
  } catch {
    return []
  }
})()
const listeners = new Set<() => void>()
function remember(hex: string): void {
  recent = [hex, ...recent.filter((c) => c !== hex)].slice(0, MAX_RECENT)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
  } catch {
    /* storage unavailable: keep them for this session */
  }
  for (const l of listeners) l()
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const getRecent = () => recent

/** A CSS keyword or rgb() value as hex, read back through a canvas (the browser knows every keyword). */
let probe: CanvasRenderingContext2D | null = null
function cssToHex(css: string): string | null {
  probe ??= document.createElement('canvas').getContext('2d')
  if (!probe) return null
  probe.fillStyle = css
  return parseColor(probe.fillStyle) ? toHex(parseColor(probe.fillStyle)!) : null
}

interface EyeDropperResult {
  sRGBHex: string
}
type EyeDropperCtor = new () => { open: () => Promise<EyeDropperResult> }
const eyeDropper = (): EyeDropperCtor | null =>
  (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper ?? null

// ---------------------------------------------------------------------------------- the picker
interface Props {
  label: string
  value: string
  onChange: (hex: string) => void
  /** Allow transparency (an alpha slider). */
  alpha?: boolean
}

/** A swatch that opens a full colour picker: any colour, by spectrum, number, name, palette or eyedropper. */
export function ColorPicker({ label, value, onChange, alpha = true }: Props) {
  const t = useT()
  const lang = useLang((s) => s.lang)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'palette' | 'names'>('palette')
  const [query, setQuery] = useState('')
  const rgba = parseColor(value) ?? { r: 255, g: 255, b: 255, a: 1 }
  // keep the hue while the colour is grey (grey has no hue of its own)
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(rgba))
  const lastEmitted = useRef(value)
  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value
      const parsed = parseColor(value)
      if (parsed) {
        const next = rgbToHsv(parsed)
        setHsv((prev) => (next.s === 0 ? { ...next, h: prev.h } : next))
      }
    }
  }, [value])
  const recentColours = useSyncExternalStore(subscribe, getRecent)
  const grid = useMemo(paletteGrid, [])
  const names = useMemo(() => searchNamed(query), [query])
  const [hexText, setHexText] = useState(value)
  useEffect(() => setHexText(value), [value])

  const emit = (next: string) => {
    lastEmitted.current = next
    onChange(next)
  }
  const fromHsv = (next: Hsv, a = rgba.a) => {
    setHsv(next)
    emit(toHex(hsvToRgb(next, alpha ? a : 1)))
  }
  const pick = (hex: string) => {
    const parsed = parseColor(hex)
    if (!parsed) return
    const withAlpha = toHex({ ...parsed, a: alpha ? (parsed.a < 1 ? parsed.a : rgba.a) : 1 })
    setHsv(rgbToHsv(parsed))
    emit(withAlpha)
    remember(toHex({ ...parsed, a: 1 }))
  }
  const close = () => {
    setOpen(false)
    remember(toHex({ ...rgba, a: 1 }))
  }

  // drag in the saturation / brightness square
  const square = useRef<HTMLDivElement>(null)
  const dragSquare = (e: React.PointerEvent) => {
    const rect = square.current?.getBoundingClientRect()
    if (!rect) return
    const s = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const v = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height))
    fromHsv({ h: hsv.h, s, v })
  }
  const solid = toHex({ ...rgba, a: 1 })
  const nameOf = (c: NamedColour) => (lang === 'ar' ? c.ar : c.en)

  return (
    <div className="colour-field" data-open={open}>
      <button
        type="button"
        className="colour-trigger"
        aria-expanded={open}
        aria-label={`${t(label)}: ${value}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="colour-label">{t(label)}</span>
        <span className="colour-chip" style={{ '--c': value } as React.CSSProperties} />
        <span className="colour-code" dir="ltr">
          {value.toUpperCase()}
        </span>
        <Icon
          name={open ? 'chevronDown' : 'chevronRight'}
          size={14}
          className={open ? undefined : 'rtl-flip'}
        />
      </button>
      {open && (
        <div className="colour-panel" dir="ltr">
          <div
            ref={square}
            className="colour-square"
            style={{ '--hue': hsv.h } as React.CSSProperties}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              dragSquare(e)
            }}
            onPointerMove={(e) => e.buttons && dragSquare(e)}
            onPointerUp={() => remember(solid)}
            role="slider"
            aria-label={t('Saturation and brightness')}
            aria-valuetext={`${Math.round(hsv.s * 100)}% / ${Math.round(hsv.v * 100)}%`}
            tabIndex={0}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 0.1 : 0.02
              const moves: Record<string, Partial<Hsv>> = {
                ArrowLeft: { s: Math.max(0, hsv.s - step) },
                ArrowRight: { s: Math.min(1, hsv.s + step) },
                ArrowUp: { v: Math.min(1, hsv.v + step) },
                ArrowDown: { v: Math.max(0, hsv.v - step) },
              }
              const move = moves[e.key]
              if (move) {
                e.preventDefault()
                fromHsv({ ...hsv, ...move })
              }
            }}
          >
            <span
              className="colour-handle"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
            />
          </div>
          <div className="colour-row">
            {eyeDropper() && (
              <button
                type="button"
                className="icon-button"
                aria-label={t('Pick a colour from the screen')}
                title={t('Pick a colour from the screen')}
                onClick={async () => {
                  const Ctor = eyeDropper()
                  if (!Ctor) return
                  try {
                    pick((await new Ctor().open()).sRGBHex)
                  } catch {
                    /* cancelled */
                  }
                }}
              >
                <Icon name="eyedropper" size={16} />
              </button>
            )}
            <span className="colour-preview" style={{ '--c': value } as React.CSSProperties} />
            <div className="colour-sliders">
              <input
                type="range"
                className="colour-hue"
                min={0}
                max={360}
                step={1}
                value={Math.round(hsv.h)}
                aria-label={t('Hue')}
                onChange={(e) => fromHsv({ ...hsv, h: Number(e.target.value) })}
                onPointerUp={() => remember(solid)}
              />
              {alpha && (
                <input
                  type="range"
                  className="colour-alpha"
                  style={{ '--c': solid } as React.CSSProperties}
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(rgba.a * 100)}
                  aria-label={t('Opacity')}
                  onChange={(e) => fromHsv(hsv, Number(e.target.value) / 100)}
                />
              )}
            </div>
          </div>
          <div className="colour-numbers">
            <label>
              <span>HEX</span>
              <input
                value={hexText}
                spellCheck={false}
                aria-label="HEX"
                onChange={(e) => {
                  setHexText(e.target.value)
                  const parsed = parseColor(e.target.value)
                  if (parsed) pick(toHex(alpha ? parsed : { ...parsed, a: 1 }))
                }}
              />
            </label>
            {(['r', 'g', 'b'] as const).map((k) => (
              <label key={k}>
                <span>{k.toUpperCase()}</span>
                <input
                  type="number"
                  min={0}
                  max={255}
                  value={Math.round(rgba[k])}
                  aria-label={k.toUpperCase()}
                  onChange={(e) => {
                    const n = Math.min(255, Math.max(0, Number(e.target.value) || 0))
                    pick(toHex({ ...rgba, [k]: n }))
                  }}
                />
              </label>
            ))}
            {alpha && (
              <label>
                <span>A%</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(rgba.a * 100)}
                  aria-label={t('Opacity')}
                  onChange={(e) =>
                    fromHsv(hsv, Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100)
                  }
                />
              </label>
            )}
          </div>
          {recentColours.length > 0 && (
            <div className="colour-swatches colour-recent" role="list" aria-label={t('Recent colours')}>
              {recentColours.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="listitem"
                  style={{ '--c': c } as React.CSSProperties}
                  title={c}
                  aria-label={c}
                  onClick={() => pick(c)}
                />
              ))}
            </div>
          )}
          <div className="segmented segmented-compact colour-tabs" role="tablist">
            {(
              [
                ['palette', 'Palette'],
                ['names', 'By name'],
              ] as const
            ).map(([id, text]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                data-active={tab === id}
                onClick={() => setTab(id)}
              >
                {t(text)}
              </button>
            ))}
          </div>
          {tab === 'palette' ? (
            <div className="colour-grid" role="list" aria-label={t('Palette')}>
              {grid.flat().map((c) => (
                <button
                  key={c}
                  type="button"
                  role="listitem"
                  style={{ '--c': c } as React.CSSProperties}
                  data-active={c === solid}
                  title={c}
                  aria-label={c}
                  onClick={() => pick(c)}
                />
              ))}
            </div>
          ) : (
            <div className="colour-names" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
              <input
                type="search"
                className="colour-search"
                value={query}
                placeholder={t('Search colours (red, أحمر, navy…)')}
                aria-label={t('Search colours')}
                onChange={(e) => setQuery(e.target.value)}
              />
              <ul>
                {names.map((c) => (
                  <li key={c.en}>
                    <button
                      type="button"
                      onClick={() => {
                        const hex = cssToHex(c.css)
                        if (hex) pick(hex)
                      }}
                    >
                      <span className="colour-chip" style={{ '--c': c.css } as React.CSSProperties} />
                      <span>{nameOf(c)}</span>
                      <span className="colour-alt">{lang === 'ar' ? c.en : c.ar}</span>
                    </button>
                  </li>
                ))}
                {names.length === 0 && <li className="muted">{t('No colour has that name.')}</li>}
              </ul>
            </div>
          )}
          <button type="button" className="button colour-done" onClick={close}>
            {t('Done')}
          </button>
        </div>
      )}
    </div>
  )
}

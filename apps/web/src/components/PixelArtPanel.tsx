import { useEffect, useRef, useState } from 'react'
import { fetchPixelPalettes, importPixelPalette, type PixelPaletteInfo } from '../api/edit'
import { defaultPixelArt, type Dither, type PixelArt } from '../engine/types'
import { committedState, useDisplayedState, useEdit } from '../state/edit'
import { usePixelPreview } from '../state/pixelPreview'
import { Check, Field, Group, Segmented, Slider } from './controls'

const DITHERS: { value: Dither; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'bayer2', label: 'Ordered 2×2' },
  { value: 'bayer4', label: 'Ordered 4×4' },
  { value: 'bayer8', label: 'Ordered 8×8' },
  { value: 'floyd', label: 'Floyd–Steinberg' },
  { value: 'atkinson', label: 'Atkinson' },
]

const SCALES = [
  { value: '0', label: 'Same size', title: 'Keep the picture’s own size; each art pixel is a square block' },
  { value: '1', label: '1×', title: 'One real pixel per art pixel (the sprite itself)' },
  { value: '2', label: '2×' },
  { value: '4', label: '4×' },
  { value: '8', label: '8×' },
] as const

const previewArt = (art: PixelArt) => useEdit.getState().preview({ ...committedState(), pixelart: art })
const commitArt = (label: string, art: PixelArt | null) =>
  useEdit.getState().commit(label, { ...committedState(), pixelart: art })

function Strip({ colors, title }: { colors: string[]; title?: string }) {
  return (
    <span className="swatch-strip" title={title} aria-hidden>
      {colors.slice(0, 32).map((c, i) => (
        <i key={`${c}-${i}`} style={{ background: c }} />
      ))}
    </span>
  )
}

export function PixelArtPanel() {
  const art = useDisplayedState().pixelart ?? null
  const info = usePixelPreview((s) => s.info)
  const loading = usePixelPreview((s) => s.loading)
  const error = usePixelPreview((s) => s.error)
  const [palettes, setPalettes] = useState<PixelPaletteInfo[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    fetchPixelPalettes()
      .then((list) => alive && setPalettes(list))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  if (!art) {
    return (
      <div className="tool-panel">
        <div className="tool-panel-head">
          <h4>Pixel art</h4>
        </div>
        <p className="hint">
          Turns the picture into crisp pixel art: a chosen palette, optional dithering and an outline. It is
          drawn on top of your other edits and is what gets exported.
        </p>
        <button
          type="button"
          className="button button-primary"
          onClick={() => commitArt('Pixel art on', defaultPixelArt())}
        >
          Make it pixel art
        </button>
      </div>
    )
  }

  const set = (label: string, patch: Partial<PixelArt>) => commitArt(label, { ...art, ...patch })
  const live = (patch: Partial<PixelArt>) => previewArt({ ...art, ...patch })
  const chosen = palettes.find((p) => p.id === art.palette)

  const importFile = async (picked: File | undefined) => {
    if (!picked) return
    setImportError(null)
    try {
      const colors = await importPixelPalette(picked)
      set('Import palette', { palette: 'custom', custom_palette: colors.slice(0, 64) })
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'That palette could not be read.')
    }
  }

  return (
    <div className="tool-panel">
      <div className="tool-panel-head">
        <h4>Pixel art</h4>
        <button type="button" className="button" onClick={() => commitArt('Pixel art off', null)}>
          Turn off
        </button>
      </div>
      <p className="hint" aria-live="polite">
        {error
          ? error
          : loading
            ? 'Updating…'
            : info
              ? `${info.grid[0]} × ${info.grid[1]} art pixels · ${info.colors} colours`
              : ''}
      </p>

      <Group title="Pixels">
        <Slider
          label="Pixel size"
          value={art.pixel_size}
          min={2}
          max={32}
          neutral={6}
          unit="px"
          onPreview={(v) => live({ pixel_size: v })}
          onCommit={(v) => set(`Pixel size ${v}`, { pixel_size: v })}
        />
        <Slider
          label="Smoothing"
          value={art.smooth}
          min={0}
          max={100}
          neutral={30}
          onPreview={(v) => live({ smooth: v })}
          onCommit={(v) => set(`Smoothing ${v}`, { smooth: v })}
        />
      </Group>

      <Group title="Palette">
        <div className="palette-list" role="radiogroup" aria-label="Palette">
          <button
            type="button"
            role="radio"
            aria-checked={art.palette === 'auto'}
            data-active={art.palette === 'auto'}
            onClick={() => set('Palette: automatic', { palette: 'auto' })}
          >
            <span>Automatic</span>
            <small>picked from the picture</small>
          </button>
          {palettes.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={art.palette === p.id}
              data-active={art.palette === p.id}
              onClick={() => set(`Palette: ${p.label}`, { palette: p.id as PixelArt['palette'] })}
            >
              <span>{p.label}</span>
              <Strip colors={p.colors} title={`${p.colors.length} colours`} />
            </button>
          ))}
          {art.custom_palette.length > 0 && (
            <button
              type="button"
              role="radio"
              aria-checked={art.palette === 'custom'}
              data-active={art.palette === 'custom'}
              onClick={() => set('Palette: imported', { palette: 'custom' })}
            >
              <span>Imported</span>
              <Strip colors={art.custom_palette} title={`${art.custom_palette.length} colours`} />
            </button>
          )}
        </div>
        {art.palette === 'auto' && (
          <Slider
            label="Colours"
            value={art.colors}
            min={2}
            max={64}
            neutral={16}
            onPreview={(v) => live({ colors: v })}
            onCommit={(v) => set(`Colours ${v}`, { colors: v })}
          />
        )}
        {chosen && <p className="hint">{chosen.colors.length} colours</p>}
        <button type="button" className="button" onClick={() => file.current?.click()}>
          Import palette (.hex, .gpl)
        </button>
        <input
          ref={file}
          type="file"
          accept=".hex,.gpl,.txt"
          hidden
          onChange={(e) => {
            void importFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        {importError && <p className="hint hint-error">{importError}</p>}
      </Group>

      <Group title="Dithering">
        <Field label="Pattern">
          <span className="select-wrap">
            <select
              value={art.dither}
              onChange={(e) => set(`Dither: ${e.target.value}`, { dither: e.target.value as Dither })}
            >
              {DITHERS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </span>
        </Field>
        {art.dither !== 'none' && (
          <Slider
            label="Strength"
            value={Math.round(art.dither_strength * 100)}
            min={0}
            max={100}
            neutral={70}
            unit="%"
            onPreview={(v) => live({ dither_strength: v / 100 })}
            onCommit={(v) => set(`Dither strength ${v}`, { dither_strength: v / 100 })}
          />
        )}
      </Group>

      <Group title="Outline">
        <Check
          label="Outline the shapes"
          checked={art.outline}
          onChange={(v) => set('Outline', { outline: v })}
        />
        {art.outline && (
          <Field label="Colour">
            <input
              type="color"
              value={art.outline_color}
              aria-label="Outline colour"
              onChange={(e) => live({ outline_color: e.target.value })}
              onBlur={(e) => set('Outline colour', { outline_color: e.target.value })}
            />
          </Field>
        )}
      </Group>

      <Group title="Export size">
        <Segmented
          label="Export size"
          value={String(art.scale) as (typeof SCALES)[number]['value']}
          options={SCALES.map((s) => ({ ...s }))}
          onChange={(v) => set(`Export ${v === '0' ? 'same size' : `${v}×`}`, { scale: Number(v) })}
        />
        <p className="hint">“1×” exports the sprite itself; 4× or 8× make big, sharp blocks for sharing.</p>
      </Group>
    </div>
  )
}

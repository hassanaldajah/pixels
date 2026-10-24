import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { outputColors } from '../tokens'
import {
  makeShapeFile,
  makeTextFile,
  renderText,
  type FontKind,
  type ShapeKind,
  type TextAlign,
  type TextOptions,
} from '../lib/makeShape'
import type { LayerSource } from '../engine/types'
import { committedState, useDisplayedState } from '../state/edit'
import { useImage } from '../state/image'
import { useLayerPictures } from '../state/layers'
import { ColorPicker } from './ColorPicker'
import { Check, Segmented, Slider } from './controls'

const FONTS: { value: FontKind; label: string }[] = [
  { value: 'sans', label: 'Sans-serif' },
  { value: 'arabic', label: 'Arabic' },
  { value: 'display', label: 'Display' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Monospace' },
]

/** Ready-made looks: one click sets colours, outline, shadow and background together. */
const STYLES: { label: string; patch: Partial<Look> }[] = [
  { label: 'Plain', patch: { outlineOn: false, shadowOn: false, backgroundOn: false, gradientOn: false } },
  {
    label: 'Outlined',
    patch: {
      outlineOn: true,
      outlineWidth: 6,
      outlineColor: outputColors.black,
      shadowOn: false,
      backgroundOn: false,
    },
  },
  {
    label: 'Shadow',
    patch: { shadowOn: true, shadowBlur: 12, shadowDistance: 6, outlineOn: false, backgroundOn: false },
  },
  {
    label: 'Label',
    patch: {
      backgroundOn: true,
      backgroundPadding: 18,
      backgroundRadius: 14,
      outlineOn: false,
      shadowOn: false,
    },
  },
  { label: 'Gradient', patch: { gradientOn: true, gradientAngle: 0 } },
]

interface Look {
  outlineOn: boolean
  outlineWidth: number
  outlineColor: string
  shadowOn: boolean
  shadowBlur: number
  shadowDistance: number
  shadowColor: string
  backgroundOn: boolean
  backgroundColor: string
  backgroundPadding: number
  backgroundRadius: number
  gradientOn: boolean
  gradientColor: string
  gradientAngle: number
}

/** Add text or a simple shape as a new layer (move, blend and fade it in Layers). */
export function TextShapePanel() {
  const t = useT()
  const image = useImage((s) => s.current)
  const add = useLayerPictures((s) => s.add)
  const replacePicture = useLayerPictures((s) => s.replacePicture)
  const [text, setText] = useState('Your text')
  const [font, setFont] = useState<FontKind>('sans')
  const [size, setSize] = useState(64)
  const [color, setColor] = useState<string>(outputColors.white)
  const [bold, setBold] = useState(true)
  const [italic, setItalic] = useState(false)
  const [align, setAlign] = useState<TextAlign>('center')
  const [letterSpacing, setLetterSpacing] = useState(0)
  const [lineHeight, setLineHeight] = useState(125)
  const [look, setLook] = useState<Look>({
    outlineOn: false,
    outlineWidth: 4,
    outlineColor: outputColors.black,
    shadowOn: false,
    shadowBlur: 10,
    shadowDistance: 4,
    shadowColor: `${outputColors.black}99`,
    backgroundOn: false,
    backgroundColor: `${outputColors.black}b3`,
    backgroundPadding: 16,
    backgroundRadius: 12,
    gradientOn: false,
    gradientColor: outputColors.white,
    gradientAngle: 0,
  })
  const patch = (p: Partial<Look>) => setLook((l) => ({ ...l, ...p }))
  const [shape, setShape] = useState<ShapeKind>('rectangle')
  const [shapeColor, setShapeColor] = useState<string>(outputColors.white)
  const [shapeW, setShapeW] = useState(300)
  const [shapeH, setShapeH] = useState(200)
  const [detail, setDetail] = useState(24)
  const [busy, setBusy] = useState(false)
  const preview = useRef<HTMLDivElement>(null)

  const options: TextOptions = {
    text,
    font,
    size,
    color,
    bold,
    italic,
    align,
    letterSpacing,
    lineHeight: lineHeight / 100,
    gradient: look.gradientOn ? { color: look.gradientColor, angle: look.gradientAngle } : null,
    outline: look.outlineOn ? { width: look.outlineWidth, color: look.outlineColor } : null,
    shadow: look.shadowOn
      ? { blur: look.shadowBlur, distance: look.shadowDistance, color: look.shadowColor }
      : null,
    background: look.backgroundOn
      ? { color: look.backgroundColor, padding: look.backgroundPadding, radius: look.backgroundRadius }
      : null,
  }
  const key = JSON.stringify(options)

  // a selected text layer fills the panel with its settings, so its words and look can be changed
  const selectedId = useLayerPictures((s) => s.selected)
  const editing = (useDisplayedState().layers ?? []).find(
    (l) => l.id === selectedId && l.source?.kind === 'text',
  )
  const editingId = editing?.id
  useEffect(() => {
    if (!editingId) return
    const layer = (committedState().layers ?? []).find((l) => l.id === editingId)
    const o = layer?.source?.options as Partial<TextOptions> | undefined
    if (!o || typeof o.text !== 'string') return
    setText(o.text)
    setFont(o.font ?? 'sans')
    setSize(o.size ?? 64)
    setColor(o.color ?? outputColors.white)
    setBold(o.bold ?? true)
    setItalic(o.italic ?? false)
    setAlign(o.align ?? 'center')
    setLetterSpacing(o.letterSpacing ?? 0)
    setLineHeight(Math.round((o.lineHeight ?? 1.25) * 100))
    setLook((l) => ({
      ...l,
      gradientOn: !!o.gradient,
      ...(o.gradient ? { gradientColor: o.gradient.color, gradientAngle: o.gradient.angle } : {}),
      outlineOn: !!o.outline,
      ...(o.outline ? { outlineColor: o.outline.color, outlineWidth: o.outline.width } : {}),
      shadowOn: !!o.shadow,
      ...(o.shadow
        ? { shadowColor: o.shadow.color, shadowBlur: o.shadow.blur, shadowDistance: o.shadow.distance }
        : {}),
      backgroundOn: !!o.background,
      ...(o.background
        ? {
            backgroundColor: o.background.color,
            backgroundPadding: o.background.padding,
            backgroundRadius: o.background.radius,
          }
        : {}),
    }))
  }, [editingId])

  // live preview: the same drawing code as the layer, at a smaller size
  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(async () => {
      const box = preview.current
      if (!box || !text.trim()) return
      const full = await renderText(JSON.parse(key) as TextOptions, 1)
      if (cancelled) return
      const fit = Math.min(1, (box.clientWidth - 16) / full.width, 140 / full.height)
      full.style.width = `${Math.round(full.width * fit)}px`
      full.style.height = `${Math.round(full.height * fit)}px`
      box.replaceChildren(full)
    }, 60)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [key, text])

  if (!image) return <p className="muted">{t('Open an image to add text or shapes.')}</p>

  const run = async (make: () => Promise<File>, source?: LayerSource) => {
    setBusy(true)
    try {
      await add(await make(), undefined, source)
    } finally {
      setBusy(false)
    }
  }
  const textSource = (): LayerSource => ({
    kind: 'text',
    options: JSON.parse(key) as Record<string, unknown>,
  })
  const update = async () => {
    if (!editing) return
    setBusy(true)
    try {
      await replacePicture(editing.id, await makeTextFile(options), textSource())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="layers-panel text-panel">
      <p className="hint">
        {t(
          'Text and shapes become layers. After adding one, move it, fade it or change how it blends in the Layers section.',
        )}
      </p>
      <label className="field">
        <span>{t('Text')}</span>
        <textarea
          className="text-input"
          rows={2}
          maxLength={400}
          value={text}
          dir="auto"
          aria-label={t('Text')}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div ref={preview} className="text-preview" aria-label={t('Preview')} role="img" />
      <div className="chips" role="group" aria-label={t('Text style')}>
        {STYLES.map((s) => (
          <button key={s.label} type="button" className="chip-button" onClick={() => patch(s.patch)}>
            {t(s.label)}
          </button>
        ))}
      </div>
      <label className="field">
        <span>{t('Font')}</span>
        <span className="select-wrap">
          <select value={font} onChange={(e) => setFont(e.target.value as FontKind)}>
            {FONTS.map((f) => (
              <option key={f.value} value={f.value}>
                {t(f.label)}
              </option>
            ))}
          </select>
        </span>
      </label>
      <Slider
        label="Text size"
        value={size}
        min={8}
        max={400}
        neutral={64}
        unit="px"
        onPreview={setSize}
        onCommit={setSize}
      />
      <ColorPicker label="Text colour" value={color} onChange={setColor} />
      <div className="inline-checks">
        <Check label="Bold" checked={bold} onChange={setBold} />
        <Check label="Italic" checked={italic} onChange={setItalic} />
      </div>
      <Segmented<TextAlign>
        label="Alignment"
        value={align}
        onChange={setAlign}
        options={[
          { value: 'start', label: 'Start' },
          { value: 'center', label: 'Centre' },
          { value: 'end', label: 'End' },
        ]}
      />
      <Slider
        label="Letter spacing"
        value={letterSpacing}
        min={-10}
        max={60}
        neutral={0}
        unit="px"
        onPreview={setLetterSpacing}
        onCommit={setLetterSpacing}
      />
      <Slider
        label="Line spacing"
        value={lineHeight}
        min={80}
        max={250}
        neutral={125}
        unit="%"
        onPreview={setLineHeight}
        onCommit={setLineHeight}
      />

      <Check label="Gradient fill" checked={look.gradientOn} onChange={(v) => patch({ gradientOn: v })} />
      {look.gradientOn && (
        <>
          <ColorPicker
            label="Second colour"
            value={look.gradientColor}
            onChange={(c) => patch({ gradientColor: c })}
          />
          <Slider
            label="Gradient angle"
            value={look.gradientAngle}
            min={0}
            max={360}
            neutral={0}
            unit="°"
            onPreview={(v) => patch({ gradientAngle: v })}
            onCommit={(v) => patch({ gradientAngle: v })}
          />
        </>
      )}
      <Check label="Outline" checked={look.outlineOn} onChange={(v) => patch({ outlineOn: v })} />
      {look.outlineOn && (
        <>
          <ColorPicker
            label="Outline colour"
            value={look.outlineColor}
            onChange={(c) => patch({ outlineColor: c })}
          />
          <Slider
            label="Outline width"
            value={look.outlineWidth}
            min={1}
            max={40}
            neutral={4}
            unit="px"
            onPreview={(v) => patch({ outlineWidth: v })}
            onCommit={(v) => patch({ outlineWidth: v })}
          />
        </>
      )}
      <Check label="Shadow" checked={look.shadowOn} onChange={(v) => patch({ shadowOn: v })} />
      {look.shadowOn && (
        <>
          <ColorPicker
            label="Shadow colour"
            value={look.shadowColor}
            onChange={(c) => patch({ shadowColor: c })}
          />
          <Slider
            label="Shadow softness"
            value={look.shadowBlur}
            min={0}
            max={80}
            neutral={10}
            unit="px"
            onPreview={(v) => patch({ shadowBlur: v })}
            onCommit={(v) => patch({ shadowBlur: v })}
          />
          <Slider
            label="Shadow distance"
            value={look.shadowDistance}
            min={-60}
            max={60}
            neutral={4}
            unit="px"
            onPreview={(v) => patch({ shadowDistance: v })}
            onCommit={(v) => patch({ shadowDistance: v })}
          />
        </>
      )}
      <Check
        label="Background box"
        checked={look.backgroundOn}
        onChange={(v) => patch({ backgroundOn: v })}
      />
      {look.backgroundOn && (
        <>
          <ColorPicker
            label="Box colour"
            value={look.backgroundColor}
            onChange={(c) => patch({ backgroundColor: c })}
          />
          <Slider
            label="Box padding"
            value={look.backgroundPadding}
            min={0}
            max={120}
            neutral={16}
            unit="px"
            onPreview={(v) => patch({ backgroundPadding: v })}
            onCommit={(v) => patch({ backgroundPadding: v })}
          />
          <Slider
            label="Corner radius"
            value={look.backgroundRadius}
            min={0}
            max={120}
            neutral={12}
            unit="px"
            onPreview={(v) => patch({ backgroundRadius: v })}
            onCommit={(v) => patch({ backgroundRadius: v })}
          />
        </>
      )}
      {editing ? (
        <>
          <p className="hint" role="status">
            {t('Editing the text layer “{name}”. Change anything above, then update it.', {
              name: editing.name,
            })}
          </p>
          <button
            type="button"
            className="button button-primary"
            disabled={busy || text.trim() === ''}
            onClick={() => void update()}
          >
            {t('Update text layer')}
          </button>
          <button
            type="button"
            className="button"
            disabled={busy || text.trim() === ''}
            onClick={() => void run(() => makeTextFile(options), textSource())}
          >
            {t('Add as a new layer')}
          </button>
        </>
      ) : (
        <button
          type="button"
          className="button button-primary"
          disabled={busy || text.trim() === ''}
          onClick={() => void run(() => makeTextFile(options), textSource())}
        >
          {t('Add text layer')}
        </button>
      )}
      <hr />
      <label className="field">
        <span>{t('Shape')}</span>
        <span className="select-wrap">
          <select value={shape} onChange={(e) => setShape(e.target.value as ShapeKind)}>
            <option value="rectangle">{t('Rectangle')}</option>
            <option value="ellipse">{t('Ellipse')}</option>
            <option value="line">{t('Line')}</option>
          </select>
        </span>
      </label>
      <ColorPicker label="Shape colour" value={shapeColor} onChange={setShapeColor} />
      <Slider
        label="Width"
        value={shapeW}
        min={10}
        max={Math.max(100, image.width)}
        neutral={300}
        unit="px"
        onPreview={setShapeW}
        onCommit={setShapeW}
      />
      {shape !== 'line' && (
        <Slider
          label="Height"
          value={shapeH}
          min={10}
          max={Math.max(100, image.height)}
          neutral={200}
          unit="px"
          onPreview={setShapeH}
          onCommit={setShapeH}
        />
      )}
      {shape !== 'ellipse' && (
        <Slider
          label={shape === 'line' ? 'Thickness' : 'Corner radius'}
          value={detail}
          min={shape === 'line' ? 1 : 0}
          max={shape === 'line' ? 80 : 300}
          neutral={shape === 'line' ? 4 : 24}
          unit="px"
          onPreview={setDetail}
          onCommit={setDetail}
        />
      )}
      <button
        type="button"
        className="button"
        disabled={busy}
        onClick={() =>
          void run(() =>
            makeShapeFile({
              kind: shape,
              width: shapeW,
              height: shape === 'line' ? Math.max(detail, 2) + 4 : shapeH,
              color: shapeColor,
              detail,
            }),
          )
        }
      >
        {t('Add shape layer')}
      </button>
    </div>
  )
}

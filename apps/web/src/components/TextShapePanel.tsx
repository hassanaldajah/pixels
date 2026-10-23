import { useState } from 'react'
import { useT } from '../i18n'
import { outputColors } from '../tokens'
import { makeShapeFile, makeTextFile, type FontKind, type ShapeKind } from '../lib/makeShape'
import { useImage } from '../state/image'
import { useLayerPictures } from '../state/layers'
import { Check, Slider } from './controls'

const hexOk = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v)

/** Add text or a simple shape as a new layer (move, blend and fade it in Layers). */
export function TextShapePanel() {
  const t = useT()
  const image = useImage((s) => s.current)
  const add = useLayerPictures((s) => s.add)
  const [text, setText] = useState('Your text')
  const [font, setFont] = useState<FontKind>('sans')
  const [size, setSize] = useState(64)
  const [color, setColor] = useState<string>(outputColors.white)
  const [bold, setBold] = useState(true)
  const [italic, setItalic] = useState(false)
  const [shape, setShape] = useState<ShapeKind>('rectangle')
  const [shapeW, setShapeW] = useState(300)
  const [shapeH, setShapeH] = useState(200)
  const [detail, setDetail] = useState(24)
  const [busy, setBusy] = useState(false)
  if (!image) return <p className="muted">{t('Open an image to add text or shapes.')}</p>
  const colour = hexOk(color) ? color : outputColors.white

  const run = async (make: () => Promise<File>) => {
    setBusy(true)
    try {
      await add(await make())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="layers-panel">
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
          aria-label={t('Text')}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <label className="field">
        <span>{t('Font')}</span>
        <span className="select-wrap">
          <select value={font} onChange={(e) => setFont(e.target.value as FontKind)}>
            <option value="sans">{t('Sans-serif')}</option>
            <option value="serif">{t('Serif')}</option>
            <option value="mono">{t('Monospace')}</option>
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
      <label className="field">
        <span>{t('Colour')}</span>
        <input
          type="color"
          value={colour}
          aria-label={t('Colour')}
          onChange={(e) => setColor(e.target.value)}
        />
      </label>
      <Check label="Bold" checked={bold} onChange={setBold} />
      <Check label="Italic" checked={italic} onChange={setItalic} />
      <button
        type="button"
        className="button"
        disabled={busy || text.trim() === ''}
        onClick={() => void run(() => makeTextFile({ text, font, size, color: colour, bold, italic }))}
      >
        {t('Add text layer')}
      </button>
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
              color: colour,
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

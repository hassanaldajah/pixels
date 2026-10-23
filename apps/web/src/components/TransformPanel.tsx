import { useEffect, useState } from 'react'
import { detectHorizon } from '../api/edit'
import { RejectionError } from '../api/client'
import { outputSize } from '../engine/geometry'
import type { Anchor, GeoOp } from '../engine/types'
import { useT } from '../i18n'
import { committedState, useEdit } from '../state/edit'
import { useImage } from '../state/image'
import { outputColors } from '../tokens'
import {
  RATIOS,
  fitRatio,
  fromUnit,
  resolveRatio,
  toUnit,
  useTransform,
  type TransformTab,
  type Unit,
} from '../state/transform'
import { Field, Group, Segmented, Slider } from './controls'
import { Icon } from './Icon'

/** The picture as the user currently sees it (after committed geometry). */
function useShownSize(): { w: number; h: number } {
  const image = useImage((s) => s.current)
  useEdit((s) => s.index)
  useEdit((s) => s.history)
  if (!image) return { w: 1, h: 1 }
  return outputSize(committedState().geometry, image.width, image.height)
}

const addGeometry = (label: string, op: GeoOp) => {
  const state = committedState()
  useEdit.getState().commit(label, { ...state, geometry: [...state.geometry, op] })
}
const previewGeometry = (op: GeoOp | null) => {
  const state = committedState()
  useEdit.getState().preview(op ? { ...state, geometry: [...state.geometry, op] } : null)
}

const ANCHORS: Anchor[] = ['tl', 'tc', 'tr', 'ml', 'c', 'mr', 'bl', 'bc', 'br']

function Crop() {
  const tr = useT()
  const size = useShownSize()
  const t = useTransform()
  const ratio = resolveRatio(t.ratioId, t.customRatio, t.landscape, size.w, size.h)

  const crop = t.crop ?? { x: 0, y: 0, w: size.w, h: size.h }
  const setRect = (r: typeof crop) => t.set({ crop: r })
  const unitStep = t.unit === 'px' ? 1 : 0.01

  const choose = (id: string) => {
    const r = resolveRatio(id, t.customRatio, t.landscape, size.w, size.h)
    t.set({ ratioId: id, crop: r ? fitRatio(r, size.w, size.h) : crop })
  }
  const setDimension = (axis: 'w' | 'h', value: number) => {
    const px = Math.max(1, Math.round(fromUnit(value, t.unit, t.dpi)))
    const next = { ...crop, [axis]: Math.min(axis === 'w' ? size.w : size.h, px) }
    if (ratio) {
      if (axis === 'w') next.h = Math.min(size.h, Math.max(1, Math.round(next.w / ratio)))
      else next.w = Math.min(size.w, Math.max(1, Math.round(next.h * ratio)))
    }
    next.x = Math.min(next.x, size.w - next.w)
    next.y = Math.min(next.y, size.h - next.h)
    setRect(next)
  }
  const apply = () => {
    if (crop.w === size.w && crop.h === size.h) return
    addGeometry(`Crop ${crop.w} × ${crop.h}`, { type: 'crop', x: crop.x, y: crop.y, w: crop.w, h: crop.h })
    t.set({ crop: null })
  }

  return (
    <>
      <Group title="Aspect ratio">
        <div className="chips">
          {RATIOS.map((r) => (
            <button
              key={r.id}
              type="button"
              className="chip-button"
              data-active={t.ratioId === r.id}
              onClick={() => choose(r.id)}
            >
              {tr(r.label)}
            </button>
          ))}
        </div>
        {t.ratioId === 'custom' && (
          <div className="inline-fields">
            <input
              type="number"
              min={1}
              value={t.customRatio[0]}
              aria-label={tr('Ratio width')}
              onChange={(e) =>
                t.set({ customRatio: [Math.max(1, Number(e.target.value)), t.customRatio[1]] })
              }
            />
            <span>:</span>
            <input
              type="number"
              min={1}
              value={t.customRatio[1]}
              aria-label={tr('Ratio height')}
              onChange={(e) =>
                t.set({ customRatio: [t.customRatio[0], Math.max(1, Number(e.target.value))] })
              }
            />
          </div>
        )}
        <button
          type="button"
          className="button button-small"
          onClick={() => {
            t.set({ landscape: !t.landscape })
            window.setTimeout(() => choose(t.ratioId), 0)
          }}
        >
          {tr('Swap orientation')}
        </button>
      </Group>
      <Group title="Size">
        <div className="inline-fields">
          <Field label="Width">
            <input
              type="number"
              step={unitStep}
              min={0}
              value={Number(toUnit(crop.w, t.unit, t.dpi).toFixed(t.unit === 'px' ? 0 : 2))}
              onChange={(e) => setDimension('w', Number(e.target.value))}
            />
          </Field>
          <Field label="Height">
            <input
              type="number"
              step={unitStep}
              min={0}
              value={Number(toUnit(crop.h, t.unit, t.dpi).toFixed(t.unit === 'px' ? 0 : 2))}
              onChange={(e) => setDimension('h', Number(e.target.value))}
            />
          </Field>
          <Field label="Unit">
            <select value={t.unit} onChange={(e) => t.set({ unit: e.target.value as Unit })}>
              <option value="px">px</option>
              <option value="cm">cm</option>
              <option value="in">in</option>
            </select>
          </Field>
          <Field label="DPI">
            <input
              type="number"
              min={36}
              max={2400}
              value={t.dpi}
              disabled={t.unit === 'px'}
              onChange={(e) => t.set({ dpi: Math.min(2400, Math.max(36, Number(e.target.value) || 300)) })}
            />
          </Field>
        </div>
        <p className="hint">
          {tr('Position {x}, {y} · image {w} × {h} px', { x: crop.x, y: crop.y, w: size.w, h: size.h })}
        </p>
      </Group>
      <div className="actions">
        <button
          type="button"
          className="button button-primary"
          onClick={apply}
          disabled={crop.w === size.w && crop.h === size.h}
        >
          {tr('Apply crop')}
        </button>
        <button type="button" className="button" onClick={() => t.set({ crop: null, ratioId: 'free' })}>
          {tr('Reset')}
        </button>
      </div>
    </>
  )
}

function Rotate() {
  const tr = useT()
  const image = useImage((s) => s.current)
  const t = useTransform()
  const [angle, setAngle] = useState(0)
  const [free, setFree] = useState(0)
  const [skewX, setSkewX] = useState(0)
  const [skewY, setSkewY] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const auto = async () => {
    if (!image) return
    setBusy(true)
    setMessage(null)
    try {
      const shown = committedState().geometry.length === 0
      if (!shown)
        setMessage(
          tr('Auto-detect measures the original photo: undo your geometry edits first for best results.'),
        )
      const result = await detectHorizon(image.id)
      if (Math.abs(result.angle) < 0.05 || result.confidence < 0.3)
        setMessage(tr('No clear horizon was found. Draw one by hand instead.'))
      else
        addGeometry(`Auto straighten ${result.angle > 0 ? '+' : ''}${result.angle.toFixed(1)}°`, {
          type: 'straighten',
          angle: result.angle,
        })
    } catch (error) {
      setMessage(error instanceof RejectionError ? tr(error.message) : tr('Horizon detection failed.'))
    } finally {
      setBusy(false)
    }
  }

  const horizon = t.horizon
  const drawn = horizon
    ? Math.atan2(horizon.b[1] - horizon.a[1], horizon.b[0] - horizon.a[0]) * (180 / Math.PI)
    : null
  const drawnAngle =
    drawn === null
      ? null
      : Math.max(
          -45,
          Math.min(45, Number((-(Math.abs(drawn) > 90 ? drawn - Math.sign(drawn) * 180 : drawn)).toFixed(2))),
        )

  useEffect(() => () => previewGeometry(null), [])

  return (
    <>
      <Group title="Rotate and flip">
        <div className="button-row">
          <button
            type="button"
            className="button"
            onClick={() => addGeometry('Rotate 90° left', { type: 'rotate90', turns: 3 })}
            title={tr('Rotate 90° counter-clockwise')}
          >
            ↺ 90°
          </button>
          <button
            type="button"
            className="button"
            onClick={() => addGeometry('Rotate 90° right', { type: 'rotate90', turns: 1 })}
            title={tr('Rotate 90° clockwise')}
          >
            ↻ 90°
          </button>
          <button
            type="button"
            className="button"
            onClick={() => addGeometry('Rotate 180°', { type: 'rotate90', turns: 2 })}
          >
            180°
          </button>
          <button
            type="button"
            className="button"
            onClick={() => addGeometry('Flip horizontal', { type: 'flip', axis: 'h' })}
          >
            ⇋ {tr('Flip H')}
          </button>
          <button
            type="button"
            className="button"
            onClick={() => addGeometry('Flip vertical', { type: 'flip', axis: 'v' })}
          >
            ⇅ {tr('Flip V')}
          </button>
        </div>
      </Group>
      <Group title="Straighten">
        <Slider
          label="Angle"
          value={angle}
          min={-45}
          max={45}
          step={0.1}
          digits={1}
          unit="°"
          onPreview={(v) => {
            setAngle(v)
            previewGeometry(v === 0 ? null : { type: 'straighten', angle: v })
          }}
          onCommit={(v) => {
            setAngle(0)
            previewGeometry(null)
            if (v !== 0)
              addGeometry(`Straighten ${v > 0 ? '+' : ''}${v.toFixed(1)}°`, { type: 'straighten', angle: v })
          }}
        />
        <div className="button-row">
          <button type="button" className="button" onClick={() => void auto()} disabled={busy}>
            {busy ? tr('Looking…') : tr('Auto-detect horizon')}
          </button>
          <button
            type="button"
            className="button"
            data-active={t.drawingHorizon}
            onClick={() => t.set({ drawingHorizon: !t.drawingHorizon, horizon: null })}
          >
            <Icon name="ruler" size={15} /> {tr('Draw horizon')}
          </button>
        </div>
        {drawnAngle !== null && (
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              addGeometry(`Straighten to line ${drawnAngle > 0 ? '+' : ''}${drawnAngle}°`, {
                type: 'straighten',
                angle: drawnAngle,
              })
              t.set({ horizon: null, drawingHorizon: false })
            }}
          >
            {tr('Level the line')} ({drawnAngle > 0 ? '+' : ''}
            {drawnAngle}°)
          </button>
        )}
        {message && (
          <p className="hint" role="status">
            {message}
          </p>
        )}
        <p className="hint">
          {tr(
            'Straightening keeps the largest rectangle inside the rotated picture. Use Free rotate to keep everything.',
          )}
        </p>
      </Group>
      <Group title="Free rotate (grows the canvas)">
        <Slider
          label="Angle"
          value={free}
          min={-180}
          max={180}
          step={0.5}
          digits={1}
          unit="°"
          onPreview={(v) => {
            setFree(v)
            previewGeometry(v === 0 ? null : { type: 'rotate', angle: v, expand: true })
          }}
          onCommit={(v) => {
            setFree(0)
            previewGeometry(null)
            if (v !== 0)
              addGeometry(`Rotate ${v > 0 ? '+' : ''}${v}°`, { type: 'rotate', angle: v, expand: true })
          }}
        />
      </Group>
      <Group title="Skew">
        <Slider
          label="Horizontal"
          value={skewX}
          min={-45}
          max={45}
          step={0.5}
          digits={1}
          unit="°"
          onPreview={(v) => {
            setSkewX(v)
            previewGeometry({ type: 'skew', x: v, y: skewY })
          }}
          onCommit={(v) => {
            setSkewX(0)
            previewGeometry(null)
            if (v !== 0 || skewY !== 0) addGeometry(`Skew ${v}°, ${skewY}°`, { type: 'skew', x: v, y: skewY })
            setSkewY(0)
          }}
        />
        <Slider
          label="Vertical"
          value={skewY}
          min={-45}
          max={45}
          step={0.5}
          digits={1}
          unit="°"
          onPreview={(v) => {
            setSkewY(v)
            previewGeometry({ type: 'skew', x: skewX, y: v })
          }}
          onCommit={(v) => {
            setSkewY(0)
            previewGeometry(null)
            if (v !== 0 || skewX !== 0) addGeometry(`Skew ${skewX}°, ${v}°`, { type: 'skew', x: skewX, y: v })
            setSkewX(0)
          }}
        />
      </Group>
    </>
  )
}

function Perspective() {
  const tr = useT()
  const size = useShownSize()
  const t = useTransform()
  const quad = t.quad ?? ([[0, 0], [size.w, 0], [size.w, size.h], [0, size.h]] as [number, number][]) // prettier-ignore
  const moved = t.quad !== null
  return (
    <>
      <Group title="Four-point perspective">
        <p className="hint">
          {tr(
            'Drag the four corner handles on the picture to where each corner should end up. Use it to straighten buildings or documents photographed at an angle.',
          )}
        </p>
        <p className="hint">
          {tr('The preview updates as you drag. Areas outside the old picture become transparent.')}
        </p>
      </Group>
      <div className="actions">
        <button
          type="button"
          className="button button-primary"
          disabled={!moved}
          onClick={() => {
            addGeometry('Perspective', {
              type: 'perspective',
              quad: quad.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]),
            })
            t.set({ quad: null })
            previewGeometry(null)
          }}
        >
          {tr('Apply')}
        </button>
        <button
          type="button"
          className="button"
          disabled={!moved}
          onClick={() => {
            t.set({ quad: null })
            previewGeometry(null)
          }}
        >
          {tr('Reset corners')}
        </button>
      </div>
    </>
  )
}

function CanvasSize() {
  const tr = useT()
  const size = useShownSize()
  const [w, setW] = useState(size.w)
  const [h, setH] = useState(size.h)
  const [lock, setLock] = useState(true)
  const [anchor, setAnchor] = useState<Anchor>('c')
  const [fill, setFill] = useState<'transparent' | 'colour'>('transparent')
  const [colour, setColour] = useState<string>(outputColors.white)
  useEffect(() => {
    setW(size.w)
    setH(size.h)
  }, [size.w, size.h])
  const ratio = size.w / size.h
  return (
    <>
      <Group title="Canvas size">
        <div className="inline-fields">
          <Field label="Width">
            <input
              type="number"
              min={1}
              max={100000}
              value={w}
              onChange={(e) => {
                const v = Math.max(1, Number(e.target.value))
                setW(v)
                if (lock) setH(Math.max(1, Math.round(v / ratio)))
              }}
            />
          </Field>
          <Field label="Height">
            <input
              type="number"
              min={1}
              max={100000}
              value={h}
              onChange={(e) => {
                const v = Math.max(1, Number(e.target.value))
                setH(v)
                if (lock) setW(Math.max(1, Math.round(v * ratio)))
              }}
            />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
          <span>{tr('Keep proportions')}</span>
        </label>
        <div className="anchor-grid" role="radiogroup" aria-label={tr('Anchor')}>
          {ANCHORS.map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={anchor === a}
              data-active={anchor === a}
              onClick={() => setAnchor(a)}
              title={tr('Anchor {a}', { a })}
            />
          ))}
        </div>
        <Segmented
          label="Fill"
          value={fill}
          onChange={setFill}
          options={[
            { value: 'transparent', label: 'Transparent' },
            { value: 'colour', label: 'Colour' },
          ]}
        />
        {fill === 'colour' && (
          <input
            type="color"
            value={colour}
            aria-label={tr('Fill colour')}
            onChange={(e) => setColour(e.target.value)}
          />
        )}
        <p className="hint">{tr('Larger than the picture adds space around it; smaller crops it.')}</p>
      </Group>
      <div className="actions">
        <button
          type="button"
          className="button button-primary"
          disabled={w === size.w && h === size.h}
          onClick={() =>
            addGeometry(`Canvas ${w} × ${h}`, {
              type: 'canvas',
              w,
              h,
              anchor,
              fill: fill === 'colour' ? colour : null,
            })
          }
        >
          {tr('Apply canvas size')}
        </button>
        <button
          type="button"
          className="button"
          disabled={w === size.w && h === size.h}
          onClick={() => addGeometry(`Resize ${w} × ${h}`, { type: 'resize', w, h })}
          title={tr('Scale the picture itself to this size')}
        >
          {tr('Resize picture')}
        </button>
      </div>
    </>
  )
}

export function TransformPanel() {
  const tr = useT()
  const tab = useTransform((s) => s.tab)
  const set = useTransform((s) => s.set)
  const tabs: { value: TransformTab; label: string }[] = [
    { value: 'crop', label: 'Crop' },
    { value: 'rotate', label: 'Rotate' },
    { value: 'perspective', label: 'Perspective' },
    { value: 'canvas', label: 'Canvas' },
  ]
  return (
    <div className="tool-panel">
      <div className="tool-panel-head">
        <h4>{tr('Transform')}</h4>
      </div>
      <Segmented
        label="Transform mode"
        value={tab}
        options={tabs}
        onChange={(v) => {
          set({ tab: v, crop: null, quad: null, drawingHorizon: false, horizon: null })
          useEdit.getState().preview(null)
        }}
      />
      {tab === 'crop' && <Crop />}
      {tab === 'rotate' && <Rotate />}
      {tab === 'perspective' && <Perspective />}
      {tab === 'canvas' && <CanvasSize />}
    </div>
  )
}

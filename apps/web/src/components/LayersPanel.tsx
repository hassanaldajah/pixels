import { useRef } from 'react'
import { BLEND_MODES, MAX_LAYERS, type BlendMode, type Layer, type LayerMask } from '../engine/types'
import { useT } from '../i18n'
import { useDisplayedState } from '../state/edit'
import { useImage } from '../state/image'
import { commitLayer, moveLayer, previewLayer, removeLayer, useLayerPictures } from '../state/layers'
import { clearMask, useLayerMask } from '../state/layerMask'
import { Check, Group, Segmented, Slider } from './controls'
import { Icon } from './Icon'

type MaskKind = 'none' | LayerMask['kind']

/** Start points for a new mask, in canvas pixels: across the layer (linear) or from its centre (radial). */
function defaultMask(kind: LayerMask['kind'], layer: Layer, w: number, h: number): LayerMask {
  const lw = w * layer.scale
  const lh = h * layer.scale
  const cy = layer.y + lh / 2
  return kind === 'linear'
    ? { kind, x0: layer.x, y0: cy, x1: layer.x + lw, y1: cy, invert: false }
    : { kind, x0: layer.x + lw / 2, y0: cy, x1: layer.x + lw, y1: cy, invert: false }
}

const BLEND_LABEL: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  difference: 'Difference',
  'soft-light': 'Soft light',
  'color-dodge': 'Colour dodge',
  'color-burn': 'Colour burn',
  'hard-light': 'Hard light',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Colour',
  luminosity: 'Luminosity',
}

/** Paint on the picture to hide parts of a layer, or bring them back (the mask moves with the layer). */
function MaskBrush({ layer }: { layer: Layer }) {
  const t = useT()
  const m = useLayerMask()
  const painted = (layer.hide?.strokes.length ?? 0) > 0
  return (
    <div className="mask-brush">
      <div className="layers-actions">
        <button
          type="button"
          className={m.painting ? 'button button-primary' : 'button'}
          aria-pressed={m.painting}
          onClick={() => m.set({ painting: !m.painting })}
          title={t(
            'Paint on the picture to hide parts of this layer. Hold Alt to bring them back. Esc stops.',
          )}
        >
          <Icon name="brush" size={14} /> {m.painting ? t('Stop painting the mask') : t('Paint the mask')}
        </button>
        <button type="button" className="button" disabled={!painted} onClick={() => clearMask(layer.id)}>
          {t('Clear mask')}
        </button>
      </div>
      {m.painting && (
        <>
          <Segmented<'hide' | 'reveal'>
            label="Mask brush"
            value={m.reveal ? 'reveal' : 'hide'}
            onChange={(v) => m.set({ reveal: v === 'reveal' })}
            options={[
              { value: 'hide', label: 'Hide' },
              { value: 'reveal', label: 'Reveal' },
            ]}
          />
          <Slider
            label="Size"
            value={m.size}
            min={4}
            max={800}
            neutral={80}
            unit="px"
            onPreview={(v) => m.set({ size: Math.round(v) })}
            onCommit={(v) => m.set({ size: Math.round(v) })}
          />
          <Slider
            label="Hardness"
            value={Math.round(m.hardness * 100)}
            min={0}
            max={100}
            neutral={50}
            unit="%"
            onPreview={(v) => m.set({ hardness: v / 100 })}
            onCommit={(v) => m.set({ hardness: v / 100 })}
          />
          <Slider
            label="Flow"
            value={Math.round(m.flow * 100)}
            min={2}
            max={100}
            neutral={80}
            unit="%"
            onPreview={(v) => m.set({ flow: v / 100 })}
            onCommit={(v) => m.set({ flow: v / 100 })}
          />
        </>
      )}
    </div>
  )
}

/** The Layers section of the inspector. The layers themselves are part of the EditState (so undo, history and projects cover them). */
export function LayersPanel() {
  const t = useT()
  const image = useImage((s) => s.current)
  const layers = useDisplayedState().layers ?? []
  const { selected, select, add, error, clearError } = useLayerPictures()
  const input = useRef<HTMLInputElement>(null)
  const current = layers.find((l) => l.id === selected) ?? null
  const picture = useLayerPictures((s) => (current ? s.pictures[current.image_id] : undefined))
  if (!image) return <p className="muted">{t('Open an image to add layers.')}</p>
  const top = [...layers].reverse() // the top layer is listed first

  return (
    <div className="layers-panel">
      <p className="hint">
        {t(
          'Place another picture above this one. Every layer picture goes through the Security Gate, and the whole stack is saved in the history and in projects.',
        )}
      </p>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif,image/tiff"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void add(file)
        }}
      />
      <button
        type="button"
        className="button"
        disabled={layers.length >= MAX_LAYERS}
        onClick={() => input.current?.click()}
      >
        <Icon name="plus" size={14} /> {t('Add layer')}
      </button>
      {error && (
        <p className="hint hint-error" role="alert" onClick={clearError}>
          {t(error)}
        </p>
      )}
      {layers.length === 0 ? (
        <p className="muted">{t('No layers yet.')}</p>
      ) : (
        <ul className="layer-list" aria-label={t('Layers, top first')}>
          {top.map((layer) => (
            <li key={layer.id} data-active={layer.id === selected} data-hidden={!layer.visible}>
              <button
                type="button"
                className="icon-button"
                aria-label={
                  layer.visible
                    ? t('Hide {name}', { name: layer.name })
                    : t('Show {name}', { name: layer.name })
                }
                aria-pressed={layer.visible}
                onClick={() =>
                  commitLayer(layer.visible ? 'Hide layer' : 'Show layer', layer.id, {
                    visible: !layer.visible,
                  })
                }
              >
                <Icon name={layer.visible ? 'image' : 'close'} size={14} />
              </button>
              <button
                type="button"
                className="layer-name"
                onClick={() => select(layer.id)}
                title={layer.name}
              >
                {layer.name}
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={t('Move {name} up', { name: layer.name })}
                onClick={() => moveLayer(layer.id, 'up')}
              >
                <Icon name="chevronDown" size={14} className="flip-v" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={t('Move {name} down', { name: layer.name })}
                onClick={() => moveLayer(layer.id, 'down')}
              >
                <Icon name="chevronDown" size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={t('Delete {name}', { name: layer.name })}
                onClick={() => removeLayer(layer.id)}
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {current && (
        <Group title={current.name}>
          <Slider
            label="Opacity"
            value={current.opacity}
            min={0}
            max={100}
            neutral={100}
            unit="%"
            onPreview={(v) => previewLayer(current.id, { opacity: v })}
            onCommit={(v) => commitLayer('Layer opacity', current.id, { opacity: v })}
          />
          <label className="field">
            <span>{t('Blend')}</span>
            <span className="select-wrap">
              <select
                value={current.blend}
                onChange={(e) =>
                  commitLayer('Layer blend', current.id, { blend: e.target.value as BlendMode })
                }
              >
                {BLEND_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(BLEND_LABEL[m])}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <MaskBrush layer={current} />
          <Slider
            label="Size"
            value={Math.round(current.scale * 100)}
            min={5}
            max={400}
            neutral={100}
            unit="%"
            onPreview={(v) => previewLayer(current.id, { scale: v / 100 })}
            onCommit={(v) => commitLayer('Layer size', current.id, { scale: v / 100 })}
          />
          <Slider
            label="X"
            value={current.x}
            min={-image.width}
            max={image.width}
            neutral={0}
            unit="px"
            onPreview={(v) => previewLayer(current.id, { x: Math.round(v) })}
            onCommit={(v) => commitLayer('Move layer', current.id, { x: Math.round(v) })}
          />
          <Slider
            label="Y"
            value={current.y}
            min={-image.height}
            max={image.height}
            neutral={0}
            unit="px"
            onPreview={(v) => previewLayer(current.id, { y: Math.round(v) })}
            onCommit={(v) => commitLayer('Move layer', current.id, { y: Math.round(v) })}
          />
          <label className="field">
            <span>{t('Fade')}</span>
            <span className="select-wrap">
              <select
                value={current.mask?.kind ?? 'none'}
                onChange={(e) => {
                  const kind = e.target.value as MaskKind
                  commitLayer(
                    'Layer fade',
                    current.id,
                    kind === 'none' || !picture
                      ? { mask: null }
                      : { mask: defaultMask(kind, current, picture.width, picture.height) },
                  )
                }}
              >
                <option value="none">{t('None')}</option>
                <option value="linear">{t('Linear gradient')}</option>
                <option value="radial">{t('Radial gradient')}</option>
              </select>
            </span>
          </label>
          {current.mask && (
            <MaskControls
              mask={current.mask}
              width={image.width}
              height={image.height}
              onChange={(patch, commit) =>
                (commit ? commitLayer : (_l: string, id: string, p: object) => previewLayer(id, p))(
                  'Layer fade',
                  current.id,
                  { mask: { ...current.mask!, ...patch } },
                )
              }
            />
          )}
        </Group>
      )}
    </div>
  )
}

export function MaskControls({
  mask,
  width,
  height,
  onChange,
}: {
  mask: LayerMask
  width: number
  height: number
  onChange: (patch: Partial<LayerMask>, commit: boolean) => void
}) {
  const point = (label: string, key: 'x0' | 'y0' | 'x1' | 'y1', max: number) => (
    <Slider
      key={key}
      label={label}
      value={mask[key]}
      min={-max}
      max={max * 2}
      neutral={0}
      unit="px"
      onPreview={(v) => onChange({ [key]: Math.round(v) }, false)}
      onCommit={(v) => onChange({ [key]: Math.round(v) }, true)}
    />
  )
  return (
    <>
      {point(mask.kind === 'linear' ? 'Start X' : 'Centre X', 'x0', width)}
      {point(mask.kind === 'linear' ? 'Start Y' : 'Centre Y', 'y0', height)}
      {point(mask.kind === 'linear' ? 'End X' : 'Edge X', 'x1', width)}
      {point(mask.kind === 'linear' ? 'End Y' : 'Edge Y', 'y1', height)}
      <Check label="Invert" checked={mask.invert} onChange={(v) => onChange({ invert: v }, true)} />
    </>
  )
}

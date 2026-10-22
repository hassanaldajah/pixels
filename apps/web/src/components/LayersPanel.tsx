import { useRef } from 'react'
import { BLEND_MODES, MAX_LAYERS, type BlendMode } from '../engine/types'
import { useDisplayedState } from '../state/edit'
import { useImage } from '../state/image'
import { commitLayer, moveLayer, previewLayer, removeLayer, useLayerPictures } from '../state/layers'
import { Group, Slider } from './controls'
import { Icon } from './Icon'

const BLEND_LABEL: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  difference: 'Difference',
  'soft-light': 'Soft light',
}

/** The Layers section of the inspector. The layers themselves are part of the EditState (so undo, history and projects cover them). */
export function LayersPanel() {
  const image = useImage((s) => s.current)
  const layers = useDisplayedState().layers ?? []
  const { selected, select, add, error, clearError } = useLayerPictures()
  const input = useRef<HTMLInputElement>(null)
  const current = layers.find((l) => l.id === selected) ?? null
  if (!image) return <p className="muted">Open an image to add layers.</p>
  const top = [...layers].reverse() // the top layer is listed first

  return (
    <div className="layers-panel">
      <p className="hint">
        Place another picture above this one. Every layer picture goes through the Security Gate, and the
        whole stack is saved in the history and in projects.
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
        <Icon name="plus" size={14} /> Add layer
      </button>
      {error && (
        <p className="hint hint-error" role="alert" onClick={clearError}>
          {error}
        </p>
      )}
      {layers.length === 0 ? (
        <p className="muted">No layers yet.</p>
      ) : (
        <ul className="layer-list" aria-label="Layers, top first">
          {top.map((layer) => (
            <li key={layer.id} data-active={layer.id === selected} data-hidden={!layer.visible}>
              <button
                type="button"
                className="icon-button"
                aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
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
                aria-label={`Move ${layer.name} up`}
                onClick={() => moveLayer(layer.id, 'up')}
              >
                <Icon name="chevronDown" size={14} className="flip-v" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Move ${layer.name} down`}
                onClick={() => moveLayer(layer.id, 'down')}
              >
                <Icon name="chevronDown" size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Delete ${layer.name}`}
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
            <span>Blend</span>
            <span className="select-wrap">
              <select
                value={current.blend}
                onChange={(e) =>
                  commitLayer('Layer blend', current.id, { blend: e.target.value as BlendMode })
                }
              >
                {BLEND_MODES.map((m) => (
                  <option key={m} value={m}>
                    {BLEND_LABEL[m]}
                  </option>
                ))}
              </select>
            </span>
          </label>
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
        </Group>
      )}
    </div>
  )
}

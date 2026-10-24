import { useT } from '../i18n'
import { useFill, type FillKind } from '../state/fill'
import { useImage } from '../state/image'
import { ColorPicker } from './ColorPicker'
import { Check, Segmented, Slider } from './controls'

/** Fill layers: a whole-picture colour or gradient, or a paint bucket for one area. */
export function FillPanel() {
  const t = useT()
  const f = useFill()
  const image = useImage((s) => s.current)
  if (!image) return <p className="muted">{t('Open an image to add a fill.')}</p>
  return (
    <div className="layers-panel">
      <p className="hint">
        {t(
          'A fill becomes a layer: lower its opacity or change its blend mode in Layers for a tint or a light leak.',
        )}
      </p>
      <Segmented<FillKind>
        label="Fill"
        value={f.kind}
        onChange={(kind) => f.set({ kind, picking: false })}
        options={[
          { value: 'solid', label: 'Colour' },
          { value: 'gradient', label: 'Gradient' },
          { value: 'bucket', label: 'Paint bucket' },
        ]}
      />
      <ColorPicker
        label={f.kind === 'gradient' ? 'First colour' : 'Fill colour'}
        value={f.color}
        onChange={(color) => f.set({ color })}
      />
      {f.kind === 'gradient' && (
        <>
          <ColorPicker label="Second colour" value={f.color2} onChange={(color2) => f.set({ color2 })} />
          <Segmented<'linear' | 'radial'>
            label="Gradient shape"
            value={f.gradient}
            onChange={(gradient) => f.set({ gradient })}
            options={[
              { value: 'linear', label: 'Linear' },
              { value: 'radial', label: 'Radial' },
            ]}
          />
          {f.gradient === 'linear' && (
            <Slider
              label="Gradient angle"
              value={f.angle}
              min={0}
              max={360}
              neutral={90}
              unit="°"
              onPreview={(angle) => f.set({ angle })}
              onCommit={(angle) => f.set({ angle })}
            />
          )}
        </>
      )}
      {f.kind === 'bucket' && (
        <>
          <Slider
            label="Tolerance"
            value={f.tolerance}
            min={0}
            max={100}
            neutral={20}
            unit="%"
            onPreview={(tolerance) => f.set({ tolerance })}
            onCommit={(tolerance) => f.set({ tolerance })}
          />
          <Slider
            label="Soft edge"
            value={f.feather}
            min={0}
            max={40}
            neutral={1}
            unit="px"
            onPreview={(feather) => f.set({ feather })}
            onCommit={(feather) => f.set({ feather })}
          />
          <Check
            label="Connected area only"
            checked={f.contiguous}
            onChange={(contiguous) => f.set({ contiguous })}
            hint="Off: every part of the picture with a similar colour is filled."
          />
        </>
      )}
      {f.kind === 'bucket' ? (
        <button
          type="button"
          className="button button-primary"
          disabled={f.busy}
          aria-pressed={f.picking}
          onClick={() => f.set({ picking: !f.picking })}
        >
          {f.busy
            ? t('Filling…')
            : f.picking
              ? t('Click the picture… (Esc cancels)')
              : t('Pick the area to fill')}
        </button>
      ) : (
        <button
          type="button"
          className="button button-primary"
          disabled={f.busy}
          onClick={() => void f.addWhole()}
        >
          {f.busy ? t('Filling…') : t('Add fill layer')}
        </button>
      )}
      {f.error && <p className="hint hint-error">{t(f.error)}</p>}
    </div>
  )
}

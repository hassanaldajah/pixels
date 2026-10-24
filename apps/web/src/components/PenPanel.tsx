import { useT } from '../i18n'
import { usePen } from '../state/pen'
import { outputColors } from '../tokens'
import { ColorPicker } from './ColorPicker'
import { Check, Slider } from './controls'
import { Icon } from './Icon'

export function PenPanel() {
  const t = useT()
  const p = usePen()
  const ready = p.nodes.length >= 2 && (!!p.stroke || (!!p.fill && p.closed))
  return (
    <div className="tool-panel">
      <div className="tool-panel-head">
        <h4>{t('Pen')}</h4>
      </div>
      <p className="hint">
        {t(
          'Click to place corner points; click and drag for smooth curves. Click the first point to close the shape. Drag points or handles to adjust them (Alt moves one handle alone).',
        )}
      </p>
      <p className="hint">
        {p.nodes.length === 0
          ? t('Click on the picture to start a path.')
          : t('{n} points', { n: p.nodes.length }) + (p.closed ? ` · ${t('closed')}` : '')}
      </p>
      <Check
        label="Fill"
        checked={!!p.fill}
        onChange={(on) => p.set({ fill: on ? outputColors.white : null })}
        hint="The fill shows once the shape is closed."
      />
      {p.fill && <ColorPicker label="Fill colour" value={p.fill} onChange={(fill) => p.set({ fill })} />}
      <Check
        label="Outline"
        checked={!!p.stroke}
        onChange={(on) => p.set({ stroke: on ? outputColors.black : null })}
      />
      {p.stroke && (
        <>
          <ColorPicker label="Outline colour" value={p.stroke} onChange={(stroke) => p.set({ stroke })} />
          <Slider
            label="Outline width"
            value={p.width}
            min={1}
            max={200}
            neutral={6}
            unit="px"
            onPreview={(width) => p.set({ width })}
            onCommit={(width) => p.set({ width })}
          />
        </>
      )}
      <div className="layers-actions">
        <button
          type="button"
          className="button"
          disabled={p.nodes.length === 0 || p.closed}
          onClick={() => p.set({ nodes: p.nodes.slice(0, -1) })}
          title={t('Backspace')}
        >
          <Icon name="undo" size={14} /> {t('Remove last point')}
        </button>
        <button
          type="button"
          className="button"
          disabled={p.nodes.length < 3 || p.closed}
          onClick={() => p.set({ closed: true })}
        >
          {t('Close shape')}
        </button>
        <button
          type="button"
          className="button"
          disabled={p.nodes.length === 0}
          onClick={p.reset}
          title="Esc"
        >
          {t('Start over')}
        </button>
      </div>
      <button
        type="button"
        className="button button-primary"
        disabled={!ready || p.busy}
        onClick={() => void p.commit()}
      >
        {p.busy ? t('Adding…') : p.editing ? t('Update path layer') : t('Add path as a layer')}
      </button>
      {p.editing && (
        <button
          type="button"
          className="button"
          disabled={!ready || p.busy}
          onClick={() => void p.commit(true)}
        >
          {t('Add as a new layer')}
        </button>
      )}
    </div>
  )
}

import { useT } from '../i18n'
import { committedState, useDisplayedState, useEdit } from '../state/edit'
import { LIQUIFY_MODES, useLiquify, type LiquifyMode } from '../state/liquify'
import { Segmented, Slider } from './controls'

export function LiquifyPanel() {
  const t = useT()
  const l = useLiquify()
  const strokes = useDisplayedState().liquify ?? []
  return (
    <div className="tool-panel">
      <div className="tool-panel-head">
        <h4>{t('Liquify')}</h4>
      </div>
      <p className="hint">
        {t(
          'Reshape the picture by painting on it. Small, gentle strokes look natural; every stroke can be undone.',
        )}
      </p>
      <Segmented<LiquifyMode>
        label="Liquify brush"
        value={l.mode}
        onChange={(mode) => l.set({ mode })}
        options={(Object.keys(LIQUIFY_MODES) as LiquifyMode[]).map((m) => ({
          value: m,
          label: LIQUIFY_MODES[m].label,
        }))}
      />
      <p className="hint">{t(LIQUIFY_MODES[l.mode].hint)}</p>
      <Slider
        label="Size"
        value={l.size}
        min={10}
        max={1200}
        neutral={160}
        unit="px"
        onPreview={(v) => l.set({ size: Math.round(v) })}
        onCommit={(v) => l.set({ size: Math.round(v) })}
      />
      <Slider
        label="Strength"
        value={Math.round(l.strength * 100)}
        min={1}
        max={100}
        neutral={50}
        unit="%"
        onPreview={(v) => l.set({ strength: v / 100 })}
        onCommit={(v) => l.set({ strength: v / 100 })}
      />
      <button
        type="button"
        className="button"
        disabled={strokes.length === 0}
        onClick={() => useEdit.getState().commit('Reset liquify', { ...committedState(), liquify: [] })}
      >
        {t('Reset liquify')}
      </button>
    </div>
  )
}

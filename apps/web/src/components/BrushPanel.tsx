import { MAX_LOCAL } from '../engine/types'
import { useT } from '../i18n'
import { PRESETS, useBrush, type BrushMode } from '../state/brush'
import { committedState, useDisplayedState, useEdit } from '../state/edit'
import { Slider } from './controls'

/** The Brush tool: paint a light or colour change onto just the part of the picture you choose. */
export function BrushPanel() {
  const t = useT()
  const brush = useBrush()
  const local = useDisplayedState().local ?? []
  const painted = local.filter((l) => l.paint)
  const target = painted.find((l) => l.id === brush.target)
  const full = local.length >= MAX_LOCAL && !target

  return (
    <div className="tool-panel">
      <div className="tool-panel-head">
        <h4>{t('Brush')}</h4>
      </div>
      <p className="hint">
        {t(
          'Paint on the picture. The change shows only where you paint: lighten or darken an area, brighten eyes, whiten teeth. Hold Alt to rub paint out. Pick the parts yourself: nothing is detected automatically.',
        )}
      </p>
      <label className="field">
        <span>{t('Effect')}</span>
        <span className="select-wrap">
          <select
            value={brush.mode}
            onChange={(e) => brush.set({ mode: e.target.value as BrushMode, target: null })}
          >
            {(Object.keys(PRESETS) as BrushMode[]).map((m) => (
              <option key={m} value={m}>
                {t(PRESETS[m].label)}
              </option>
            ))}
          </select>
        </span>
      </label>
      <p className="hint">{t(PRESETS[brush.mode].hint)}</p>
      <Slider
        label="Size"
        value={brush.size}
        min={4}
        max={600}
        neutral={60}
        unit="px"
        onPreview={(v) => brush.set({ size: Math.round(v) })}
        onCommit={(v) => brush.set({ size: Math.round(v) })}
      />
      <Slider
        label="Hardness"
        value={Math.round(brush.hardness * 100)}
        min={0}
        max={100}
        neutral={40}
        unit="%"
        onPreview={(v) => brush.set({ hardness: v / 100 })}
        onCommit={(v) => brush.set({ hardness: v / 100 })}
      />
      <Slider
        label="Flow"
        value={Math.round(brush.flow * 100)}
        min={2}
        max={100}
        neutral={35}
        unit="%"
        onPreview={(v) => brush.set({ flow: v / 100 })}
        onCommit={(v) => brush.set({ flow: v / 100 })}
      />
      <Slider
        label="Strength"
        value={brush.strength}
        min={10}
        max={200}
        neutral={100}
        unit="%"
        onPreview={(v) => brush.set({ strength: Math.round(v) })}
        onCommit={(v) => brush.set({ strength: Math.round(v) })}
      />
      <div className="layers-actions">
        <button
          type="button"
          className="button"
          disabled={!target}
          onClick={() => brush.set({ target: null })}
        >
          {t('Start a new area')}
        </button>
        <button
          type="button"
          className="button"
          disabled={!target}
          onClick={() => {
            const state = committedState()
            useEdit.getState().commit('Clear brush', {
              ...state,
              local: (state.local ?? []).filter((l) => l.id !== brush.target),
            })
            brush.set({ target: null })
          }}
        >
          {t('Clear this area')}
        </button>
      </div>
      <p className="hint" aria-live="polite">
        {full
          ? t('You have {n} local adjustments already: delete one first.', { n: MAX_LOCAL })
          : target
            ? t('Painting into “{name}”. Fine-tune its light and colour under Local adjustments.', {
                name: target.name,
              })
            : t('Your next stroke starts a new painted area.')}
      </p>
    </div>
  )
}

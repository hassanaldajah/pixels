import { MAX_CLONE } from '../engine/types'
import { useT } from '../i18n'
import { useClone } from '../state/clone'
import { committedState, useDisplayedState, useEdit } from '../state/edit'
import { Slider } from './controls'

/** The Clone tool: copy one part of the picture onto another (remove a blemish, extend a texture). */
export function ClonePanel() {
  const t = useT()
  const clone = useClone()
  const strokes = useDisplayedState().clone ?? []
  return (
    <div className="tool-panel">
      <div className="tool-panel-head">
        <h4>{t('Clone')}</h4>
      </div>
      <p className="hint">
        {t(
          'Hold Alt and click the place to copy from, then paint where it should go. The cross shows where the copy comes from. Alt+click again to pick a new source.',
        )}
      </p>
      <Slider
        label="Size"
        value={clone.size}
        min={4}
        max={600}
        neutral={50}
        unit="px"
        onPreview={(v) => clone.set({ size: Math.round(v) })}
        onCommit={(v) => clone.set({ size: Math.round(v) })}
      />
      <Slider
        label="Hardness"
        value={Math.round(clone.hardness * 100)}
        min={0}
        max={100}
        neutral={50}
        unit="%"
        onPreview={(v) => clone.set({ hardness: v / 100 })}
        onCommit={(v) => clone.set({ hardness: v / 100 })}
      />
      <Slider
        label="Flow"
        value={Math.round(clone.flow * 100)}
        min={5}
        max={100}
        neutral={80}
        unit="%"
        onPreview={(v) => clone.set({ flow: v / 100 })}
        onCommit={(v) => clone.set({ flow: v / 100 })}
      />
      <div className="layers-actions">
        <button
          type="button"
          className="button"
          disabled={!clone.source}
          onClick={() => clone.set({ source: null, offset: null })}
        >
          {t('Forget source')}
        </button>
        <button
          type="button"
          className="button"
          disabled={strokes.length === 0}
          onClick={() => useEdit.getState().commit('Clear clone', { ...committedState(), clone: [] })}
        >
          {t('Clear all clones')}
        </button>
      </div>
      <p className="hint" aria-live="polite">
        {clone.source
          ? t('{n} of {max} strokes used.', { n: strokes.length, max: MAX_CLONE })
          : t('Pick a source first (Alt+click).')}
      </p>
    </div>
  )
}

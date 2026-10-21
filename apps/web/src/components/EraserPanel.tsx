import { useImage } from '../state/image'
import { useEraser } from '../state/eraser'
import { Group, Segmented, Slider } from './controls'

export function EraserPanel() {
  const e = useEraser()
  const canRestore = useImage((s) => s.versions.length > 0)
  const restore = useImage((s) => s.restorePrevious)

  return (
    <div className="tool-panel">
      <div className="tool-panel-head">
        <h4>Eraser</h4>
      </div>
      <p className="hint">
        Paint over what you want gone, then press Remove. The gap is filled from the surrounding texture, on
        your computer. Hold Alt to rub paint out; hold Space to move the picture.
      </p>

      <Group title="Brush">
        <Segmented
          label="Brush mode"
          value={e.paint ? 'paint' : 'rub'}
          options={[
            { value: 'paint', label: 'Paint' },
            { value: 'rub', label: 'Rub out' },
          ]}
          onChange={(v) => e.set({ paint: v === 'paint' })}
        />
        <Slider
          label="Size"
          value={e.brush}
          min={4}
          max={400}
          neutral={48}
          unit="px"
          onPreview={(v) => e.set({ brush: v })}
          onCommit={(v) => e.set({ brush: v })}
        />
      </Group>

      <Group title="Fill">
        <Segmented
          label="Quality"
          value={e.quality}
          options={[
            { value: 'fast', label: 'Fast', title: 'A quick fill for small things' },
            { value: 'high', label: 'High quality', title: 'Slower, best for textures and big areas' },
          ]}
          onChange={(v) => e.set({ quality: v })}
        />
        <Slider
          label="Grow edge"
          value={e.grow}
          min={0}
          max={60}
          neutral={6}
          unit="px"
          onPreview={(v) => e.set({ grow: v })}
          onCommit={(v) => e.set({ grow: v })}
        />
        <Slider
          label="Soften seam"
          value={e.feather}
          min={0}
          max={30}
          neutral={3}
          unit="px"
          onPreview={(v) => e.set({ feather: v })}
          onCommit={(v) => e.set({ feather: v })}
        />
        <p className="hint">“Grow edge” also covers shadows and the soft rim around what you painted.</p>
      </Group>

      <div className="eraser-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={!e.hasMask || e.busy}
          onClick={() => void e.run()}
        >
          {e.busy ? 'Removing…' : 'Remove'}
        </button>
        <button type="button" className="button" disabled={e.undoable === 0 || e.busy} onClick={e.undoStroke}>
          Undo stroke
        </button>
        <button type="button" className="button" disabled={!e.hasMask || e.busy} onClick={e.clear}>
          Clear paint
        </button>
        <button type="button" className="button" disabled={!canRestore || e.busy} onClick={restore}>
          Undo last removal
        </button>
      </div>
      {e.busy && (
        <p className="hint" aria-live="polite">
          This can take up to a minute for big areas at high quality.
        </p>
      )}
      {e.error && (
        <p className="hint hint-error" role="alert">
          {e.error}
        </p>
      )}
      <p className="hint">
        Edits you made before (crop, colours) are applied to the picture when you remove something, so paint
        after you are done with those.
      </p>
    </div>
  )
}

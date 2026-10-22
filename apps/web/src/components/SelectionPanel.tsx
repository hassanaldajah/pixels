import type { Selection } from '../engine/types'
import { committedState, useDisplayedState, useEdit } from '../state/edit'
import { useImage } from '../state/image'
import { Check, Slider } from './controls'

type Kind = 'none' | Selection['kind']

const rectOf = (w: number, h: number, kind: 'rect' | 'ellipse'): Selection => ({
  kind,
  x: Math.round(w * 0.25),
  y: Math.round(h * 0.25),
  w: Math.round(w * 0.5),
  h: Math.round(h * 0.5),
  points: [],
  feather: 0,
  invert: false,
})

const write = (label: string, selection: Selection | null) =>
  useEdit.getState().commit(label, { ...committedState(), selection })
const previewSel = (selection: Selection) => useEdit.getState().preview({ ...committedState(), selection })

/** Limits the Adjust edits to an area. The area is part of the edit state (history, undo and projects cover it). */
export function SelectionPanel() {
  const image = useImage((s) => s.current)
  const selection = useDisplayedState().selection ?? null
  if (!image) return <p className="muted">Open an image to select an area.</p>
  const { width, height } = image

  const change = (patch: Partial<Selection>, commit: boolean) => {
    if (!selection) return
    const next = { ...selection, ...patch }
    if (commit) write('Selection', next)
    else previewSel(next)
  }
  const slider = (label: string, key: 'x' | 'y' | 'w' | 'h', max: number, min = 0) => (
    <Slider
      label={label}
      value={selection?.[key] ?? 0}
      min={min}
      max={max}
      neutral={min}
      unit="px"
      onPreview={(v) => change({ [key]: Math.round(v) }, false)}
      onCommit={(v) => change({ [key]: Math.round(v) }, true)}
    />
  )

  return (
    <div className="layers-panel">
      <p className="hint">
        Adjustments (light, colour, curves, sharpen...) apply only inside the selected area. Use a feather to
        blend the edge.
      </p>
      <label className="field">
        <span>Shape</span>
        <span className="select-wrap">
          <select
            value={selection?.kind ?? 'none'}
            onChange={(e) => {
              const kind = e.target.value as Kind
              if (kind === 'none') write('Clear selection', null)
              else if (kind === 'polygon') return
              else write('Select area', rectOf(width, height, kind))
            }}
          >
            <option value="none">None (whole picture)</option>
            <option value="rect">Rectangle</option>
            <option value="ellipse">Ellipse</option>
            {selection?.kind === 'polygon' && (
              <option value="polygon">Free shape ({selection.points.length} points)</option>
            )}
          </select>
        </span>
      </label>
      {selection && selection.kind !== 'polygon' && (
        <>
          {slider('Left', 'x', width)}
          {slider('Top', 'y', height)}
          {slider('Width', 'w', width, 1)}
          {slider('Height', 'h', height, 1)}
        </>
      )}
      {selection && (
        <>
          <Slider
            label="Feather"
            value={selection.feather}
            min={0}
            max={Math.round(Math.max(width, height) / 10)}
            neutral={0}
            unit="px"
            onPreview={(v) => change({ feather: Math.round(v) }, false)}
            onCommit={(v) => change({ feather: Math.round(v) }, true)}
          />
          <Check
            label="Invert (everything else)"
            checked={selection.invert}
            onChange={(v) => change({ invert: v }, true)}
          />
        </>
      )}
    </div>
  )
}

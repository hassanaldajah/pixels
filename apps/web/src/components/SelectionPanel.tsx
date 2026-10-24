import type { Selection } from '../engine/types'
import { useT } from '../i18n'
import { committedState, useDisplayedState, useEdit } from '../state/edit'
import { useImage } from '../state/image'
import { useWandPick } from '../viewport/WandOverlay'
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
  const t = useT()
  const image = useImage((s) => s.current)
  const selection = useDisplayedState().selection ?? null
  const picking = useWandPick((s) => s.picking)
  if (!image) return <p className="muted">{t('Open an image to select an area.')}</p>
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
        {t(
          'Adjustments (light, colour, curves, sharpen...) apply only inside the selected area. Use a feather to blend the edge.',
        )}
      </p>
      <label className="field">
        <span>{t('Shape')}</span>
        <span className="select-wrap">
          <select
            value={selection?.kind ?? 'none'}
            onChange={(e) => {
              const kind = e.target.value as Kind
              if (kind === 'none') write('Clear selection', null)
              else if (kind === 'polygon') return
              else if (kind === 'wand') useWandPick.getState().set(true)
              else write('Select area', rectOf(width, height, kind))
            }}
          >
            <option value="none">{t('None (whole picture)')}</option>
            <option value="rect">{t('Rectangle')}</option>
            <option value="ellipse">{t('Ellipse')}</option>
            <option value="wand">{t('Magic wand (by colour)')}</option>
            {selection?.kind === 'polygon' && (
              <option value="polygon">{t('Free shape ({n} points)', { n: selection.points.length })}</option>
            )}
          </select>
        </span>
      </label>
      {picking && (
        <p className="hint" role="status">
          {t('Click the colour you want to select… (Esc cancels)')}
        </p>
      )}
      {selection?.kind === 'wand' && (
        <>
          <Slider
            label="Tolerance"
            value={selection.tolerance ?? 20}
            min={0}
            max={100}
            neutral={20}
            unit="%"
            onPreview={(v) => change({ tolerance: Math.round(v) }, false)}
            onCommit={(v) => change({ tolerance: Math.round(v) }, true)}
          />
          <Check
            label="Connected area only"
            checked={selection.contiguous ?? true}
            onChange={(v) => change({ contiguous: v }, true)}
            hint="Off: every part of the picture with a similar colour is selected."
          />
          <button type="button" className="button" onClick={() => useWandPick.getState().set(true)}>
            {t('Pick another colour')}
          </button>
        </>
      )}
      {selection && selection.kind !== 'polygon' && selection.kind !== 'wand' && (
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

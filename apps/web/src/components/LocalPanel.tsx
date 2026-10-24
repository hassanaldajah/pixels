import { useState } from 'react'
import { defaultAdjust, MAX_LOCAL, type Adjust, type LayerMask, type LocalAdjust } from '../engine/types'
import { useT } from '../i18n'
import { committedState, useDisplayedState, useEdit } from '../state/edit'
import { useImage } from '../state/image'
import { Group, Slider } from './controls'
import { Icon } from './Icon'
import { MaskControls } from './LayersPanel'

const newId = (): string => crypto.randomUUID().replaceAll('-', '').slice(0, 10)
const listOf = (): LocalAdjust[] => committedState().local ?? []
const write = (label: string, local: LocalAdjust[]) =>
  useEdit.getState().commit(label, { ...committedState(), local })
const edit = (id: string, patch: (item: LocalAdjust) => LocalAdjust) =>
  listOf().map((l) => (l.id === id ? patch(l) : l))
const previewList = (local: LocalAdjust[]) => useEdit.getState().preview({ ...committedState(), local })

type Key =
  | 'blur'
  | 'exposure'
  | 'contrast'
  | 'highlights'
  | 'shadows'
  | 'temperature'
  | 'tint'
  | 'vibrance'
  | 'saturation'
const ROWS: { key: Key; label: string; min: number; max: number; step?: number; digits?: number }[] = [
  { key: 'exposure', label: 'Exposure', min: -3, max: 3, step: 0.05, digits: 2 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100 },
  { key: 'temperature', label: 'Temperature', min: -100, max: 100 },
  { key: 'tint', label: 'Tint', min: -100, max: 100 },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
  { key: 'blur', label: 'Blur', min: 0, max: 32, step: 0.5, digits: 1 },
]

function startMask(kind: LayerMask['kind'], w: number, h: number): LayerMask {
  // linear: fades in from the top edge to the middle; radial: opaque in the middle, fading to the edges
  return kind === 'linear'
    ? { kind, x0: w / 2, y0: 0, x1: w / 2, y1: Math.round(h / 2), invert: true }
    : {
        kind,
        x0: Math.round(w / 2),
        y0: Math.round(h / 2),
        x1: Math.round(w * 0.9),
        y1: Math.round(h / 2),
        invert: false,
      }
}

/** Local adjustments: light and colour changes that apply only where a gradient says so (graduated and radial filters). */
export function LocalPanel() {
  const t = useT()
  const image = useImage((s) => s.current)
  const items = useDisplayedState().local ?? []
  const [selected, setSelected] = useState<string | null>(null)
  if (!image) return <p className="muted">{t('Open an image to add a local adjustment.')}</p>
  const current = items.find((l) => l.id === selected) ?? null

  const add = (kind: LayerMask['kind']) => {
    const item: LocalAdjust = {
      id: newId(),
      name: kind === 'linear' ? 'Graduated filter' : 'Radial filter',
      visible: true,
      mask: startMask(kind, image.width, image.height),
      adjust: defaultAdjust(),
    }
    write('Add local adjustment', [...listOf(), item])
    setSelected(item.id)
  }
  /** Tilt-shift: a sharp band across the middle, blur growing toward the top and bottom, a little more colour. */
  const addTiltShift = () => {
    const { width: w, height: h } = image
    const blur = Math.min(32, Math.max(4, Math.round(Math.max(w, h) / 160)))
    const band = (id: string, name: string, from: number, to: number): LocalAdjust => ({
      id,
      name,
      visible: true,
      mask: {
        kind: 'linear',
        x0: w / 2,
        y0: Math.round(h * from),
        x1: w / 2,
        y1: Math.round(h * to),
        invert: false,
      },
      adjust: { ...defaultAdjust(), blur, saturation: 15, contrast: 8 },
    })
    const top = band(newId(), 'Tilt-shift (top)', 0.38, 0.08)
    write('Tilt-shift', [...listOf(), top, band(newId(), 'Tilt-shift (bottom)', 0.62, 0.92)])
    setSelected(top.id)
  }
  const setAdjust = (id: string, key: Key, value: number, commit: boolean) => {
    const next = edit(id, (l) => ({ ...l, adjust: { ...l.adjust, [key]: value } as Adjust }))
    if (commit) write('Local adjustment', next)
    else previewList(next)
  }

  return (
    <div className="layers-panel">
      <p className="hint">
        {t(
          'Brighten a sky, darken the edges or lift a face: each filter changes light and colour only where its gradient is opaque. Stack up to {n}.',
          { n: MAX_LOCAL },
        )}
      </p>
      <div className="layers-actions">
        <button
          type="button"
          className="button"
          disabled={items.length >= MAX_LOCAL}
          onClick={() => add('linear')}
        >
          <Icon name="plus" size={14} /> {t('Graduated')}
        </button>
        <button
          type="button"
          className="button"
          disabled={items.length >= MAX_LOCAL}
          onClick={() => add('radial')}
        >
          <Icon name="plus" size={14} /> {t('Radial')}
        </button>
        <button
          type="button"
          className="button"
          disabled={items.length + 2 > MAX_LOCAL}
          onClick={addTiltShift}
          title={t(
            'A sharp band across the middle and blur above and below: the scene looks like a miniature model.',
          )}
        >
          <Icon name="plus" size={14} /> {t('Tilt-shift')}
        </button>
      </div>
      {items.length === 0 ? (
        <p className="muted">{t('No local adjustments yet.')}</p>
      ) : (
        <ul className="layer-list" aria-label={t('Local adjustments')}>
          {items.map((item) => (
            <li key={item.id} data-active={item.id === selected} data-hidden={!item.visible}>
              <button
                type="button"
                className="icon-button"
                aria-label={
                  item.visible
                    ? t('Hide {name}', { name: t(item.name) })
                    : t('Show {name}', { name: t(item.name) })
                }
                aria-pressed={item.visible}
                onClick={() =>
                  write(
                    'Toggle local adjustment',
                    edit(item.id, (l) => ({ ...l, visible: !l.visible })),
                  )
                }
              >
                <Icon name={item.visible ? 'image' : 'close'} size={14} />
              </button>
              <button
                type="button"
                className="layer-name"
                onClick={() => setSelected(item.id)}
                title={t(item.name)}
              >
                {t(item.name)}
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={t('Delete {name}', { name: t(item.name) })}
                onClick={() => {
                  write(
                    'Delete local adjustment',
                    listOf().filter((l) => l.id !== item.id),
                  )
                  if (selected === item.id) setSelected(null)
                }}
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {current && (
        <>
          <Group title="Where">
            {!current.mask && <p className="hint">{t('Painted with the Brush tool.')}</p>}
            {current.mask && (
              <MaskControls
                mask={current.mask}
                width={image.width}
                height={image.height}
                onChange={(patch, commit) => {
                  const next = edit(current.id, (l) => ({
                    ...l,
                    mask: { ...(l.mask as LayerMask), ...patch },
                  }))
                  if (commit) write('Local adjustment area', next)
                  else previewList(next)
                }}
              />
            )}
          </Group>
          <Group title="What">
            {ROWS.map((r) => (
              <Slider
                key={r.key}
                label={r.label}
                value={current.adjust[r.key]}
                min={r.min}
                max={r.max}
                step={r.step}
                digits={r.digits}
                neutral={0}
                onPreview={(v) => setAdjust(current.id, r.key, v, false)}
                onCommit={(v) => setAdjust(current.id, r.key, v, true)}
              />
            ))}
          </Group>
        </>
      )}
    </div>
  )
}

import { useT } from '../i18n'
import { BRUSHES, useDraw, type DrawBrush } from '../state/draw'
import { ColorPicker } from './ColorPicker'
import { Segmented, Slider } from './controls'
import { Icon } from './Icon'

/** Quick colours for the most common choices; the picker below has every other colour. */
const QUICK = [
  'white',
  'black',
  'red',
  'orange',
  'gold',
  'limegreen',
  'deepskyblue',
  'royalblue',
  'purple',
  'hotpink',
]
let probe: CanvasRenderingContext2D | null = null
const keywordHex = (name: string): string => {
  probe ??= document.createElement('canvas').getContext('2d')
  if (!probe) return name
  probe.fillStyle = name
  return String(probe.fillStyle)
}

export function DrawPanel() {
  const t = useT()
  const d = useDraw()
  const drawn = d.strokes.length > 0
  return (
    <div className="tool-panel">
      <div className="tool-panel-head">
        <h4>{t('Draw')}</h4>
      </div>
      <p className="hint">
        {t(
          'Draw or write by hand on the picture with the mouse, a finger or a pen. When you are done, add it as a layer: then you can move it, fade it or blend it. Leaving this tool adds it for you.',
        )}
      </p>
      <Segmented<DrawBrush>
        label="Brush"
        value={d.brush}
        onChange={(brush) => d.set({ brush })}
        options={(Object.keys(BRUSHES) as DrawBrush[]).map((b) => ({ value: b, label: BRUSHES[b].label }))}
      />
      <p className="hint">{t(BRUSHES[d.brush].hint)}</p>
      {d.brush !== 'eraser' && (
        <>
          <div className="quick-colours" role="list" aria-label={t('Quick colours')}>
            {QUICK.map((name) => {
              const hex = keywordHex(name)
              return (
                <button
                  key={name}
                  type="button"
                  role="listitem"
                  style={{ '--c': name } as React.CSSProperties}
                  data-active={d.color.toLowerCase() === hex.toLowerCase()}
                  aria-label={hex}
                  title={hex}
                  onClick={() => d.set({ color: hex })}
                />
              )
            })}
          </div>
          <ColorPicker label="Colour" value={d.color} onChange={(color) => d.set({ color })} alpha={false} />
        </>
      )}
      <Slider
        label="Size"
        value={d.size}
        min={1}
        max={300}
        neutral={12}
        unit="px"
        onPreview={(v) => d.set({ size: Math.round(v) })}
        onCommit={(v) => d.set({ size: Math.round(v) })}
      />
      {d.brush !== 'eraser' && (
        <Slider
          label="Opacity"
          value={Math.round(d.opacity * 100)}
          min={5}
          max={100}
          neutral={100}
          unit="%"
          onPreview={(v) => d.set({ opacity: v / 100 })}
          onCommit={(v) => d.set({ opacity: v / 100 })}
        />
      )}
      <Slider
        label="Smoothing"
        value={Math.round(d.smoothing * 100)}
        min={0}
        max={100}
        neutral={50}
        unit="%"
        onPreview={(v) => d.set({ smoothing: v / 100 })}
        onCommit={(v) => d.set({ smoothing: v / 100 })}
      />
      <div className="layers-actions">
        <button type="button" className="button" disabled={!drawn} onClick={d.undo} title={t('Undo stroke')}>
          <Icon name="undo" size={15} /> {t('Undo stroke')}
        </button>
        <button type="button" className="button" disabled={d.undone.length === 0} onClick={d.redo}>
          <Icon name="redo" size={15} /> {t('Redo')}
        </button>
        <button type="button" className="button" disabled={!drawn} onClick={d.clear}>
          <Icon name="trash" size={15} /> {t('Clear')}
        </button>
      </div>
      <button
        type="button"
        className="button button-primary"
        disabled={!drawn || d.busy}
        onClick={() => void d.apply()}
      >
        {d.busy ? t('Adding…') : t('Add drawing as a layer')}
      </button>
    </div>
  )
}

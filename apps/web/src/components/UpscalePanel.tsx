import { useState } from 'react'
import { useT } from '../i18n'
import { useImage } from '../state/image'
import { useRetouch } from '../state/retouch'
import { useView } from '../state/view'
import { Group, Segmented, Slider } from './controls'

const FACTORS = [
  { value: '2', label: '2×' },
  { value: '3', label: '3×' },
  { value: '4', label: '4×' },
] as const

export function UpscalePanel() {
  const t = useT()
  const retouch = useRetouch()
  const size = useView((s) => s.image)
  const canRestore = useImage((s) => s.versions.length > 0)
  const restore = useImage((s) => s.restorePrevious)
  const [factor, setFactor] = useState(2)
  const [sharpen, setSharpen] = useState(40)
  const busy = retouch.busy !== null
  const out = size ? { w: Math.round(size.w * factor), h: Math.round(size.h * factor) } : null
  const tooBig = out !== null && out.w * out.h > 100_000_000

  return (
    <div className="tool-panel">
      <div className="tool-panel-head">
        <h4>{t('Upscale')}</h4>
      </div>
      <p className="hint">
        {t(
          'Makes the picture larger with high-quality resampling and a careful sharpening pass that avoids bright or dark halos. It cannot invent detail that was never there, but it keeps edges clean.',
        )}
      </p>
      <Group title="Size">
        <Segmented
          label="Scale"
          value={String(Math.round(factor)) as (typeof FACTORS)[number]['value']}
          options={FACTORS.map((f) => ({ ...f }))}
          onChange={(v) => setFactor(Number(v))}
        />
        <Slider
          label="Custom"
          value={factor}
          min={1.1}
          max={4}
          step={0.1}
          neutral={2}
          digits={1}
          unit="×"
          onPreview={setFactor}
          onCommit={setFactor}
        />
        {out && (
          <p className="hint" aria-live="polite">
            {size?.w} × {size?.h} → {out.w} × {out.h} px
            {tooBig ? ` (${t('too large for this setup')})` : ''}
          </p>
        )}
      </Group>
      <Group title="Sharpening">
        <Slider
          label="Amount"
          value={sharpen}
          min={0}
          max={100}
          neutral={40}
          onPreview={setSharpen}
          onCommit={setSharpen}
        />
      </Group>
      <div className="eraser-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={busy || tooBig || !size}
          onClick={() => void retouch.run('upscale', { factor, sharpen })}
        >
          {retouch.busy === 'upscale' ? t('Enlarging…') : t('Enlarge')}
        </button>
        <button type="button" className="button" disabled={!canRestore || busy} onClick={restore}>
          {t('Undo last change')}
        </button>
      </div>
      {retouch.error && (
        <p className="hint hint-error" role="alert">
          {t(retouch.error)}
        </p>
      )}
    </div>
  )
}

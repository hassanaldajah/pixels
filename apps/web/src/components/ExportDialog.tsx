import { useEffect, useState } from 'react'
import { RejectionError } from '../api/client'
import { defaultExportOptions, exportImage, saveBlob, type ExportOptions } from '../api/edit'
import { useCapabilities } from '../api/queries'
import { useT } from '../i18n'
import { displayedState } from '../state/edit'
import { useImage } from '../state/image'
import { useUi } from '../state/ui'
import { Check, Field, Segmented } from './controls'
import { Icon } from './Icon'

const FORMATS: { value: ExportOptions['format']; label: string }[] = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'tiff', label: 'TIFF' },
]

const STORAGE_KEY = 'pixels.export'

function loadOptions(): ExportOptions {
  try {
    return {
      ...defaultExportOptions(),
      ...(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<ExportOptions>),
    }
  } catch {
    return defaultExportOptions()
  }
}

export function ExportDialog() {
  const t = useT()
  const open = useUi((s) => s.exportOpen)
  const set = useUi((s) => s.set)
  const image = useImage((s) => s.current)
  const caps = useCapabilities()
  const [options, setOptions] = useState<ExportOptions>(loadOptions)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(options))
    } catch {
      /* storage unavailable */
    }
  }, [options])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && set({ exportOpen: false })
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, set])

  if (!open || !image) return null
  const patch = (p: Partial<ExportOptions>) => setOptions((o) => ({ ...o, ...p }))
  const lossy = options.format === 'jpeg' || options.format === 'webp' || options.format === 'avif'
  const deep = options.format === 'png' || options.format === 'tiff'
  const close = () => set({ exportOpen: false })

  const run = async () => {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const { blob, filename } = await exportImage(image.id, displayedState(), options)
      saveBlob(blob, filename)
      setDone(`${filename} · ${(blob.size / 1024 / 1024).toFixed(2)} MB`)
    } catch (e) {
      setError(e instanceof RejectionError ? t(e.message) : t('The export failed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div
        className="dialog glass"
        role="dialog"
        aria-label={t('Export')}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <h3>{t('Export')}</h3>
          <button type="button" className="icon-button" aria-label={t('Close')} onClick={close}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <Segmented
          label="Format"
          value={options.format}
          onChange={(format) => patch({ format })}
          options={FORMATS.map((f) => ({
            ...f,
            disabled: caps.data ? !caps.data.formats[f.value] : false,
            title:
              caps.data && !caps.data.formats[f.value] ? t('Not supported by this installation') : undefined,
          }))}
        />
        {lossy && (
          <Field label={`${t('Quality')} ${options.quality}`}>
            <input
              type="range"
              min={1}
              max={100}
              value={options.quality}
              disabled={options.format === 'webp' && options.lossless}
              onChange={(e) => patch({ quality: Number(e.target.value) })}
            />
          </Field>
        )}
        {options.format === 'webp' && (
          <Check label="Lossless" checked={options.lossless} onChange={(lossless) => patch({ lossless })} />
        )}
        {deep && (
          <Field label="Bit depth">
            <Segmented
              label="Bit depth"
              value={String(options.bit_depth) as '8' | '16'}
              onChange={(v) => patch({ bit_depth: Number(v) as 8 | 16 })}
              options={[
                { value: '8', label: '8-bit' },
                { value: '16', label: '16-bit' },
              ]}
            />
          </Field>
        )}
        {deep && options.bit_depth === 16 && (
          <p className="hint">
            {t(
              'The 16-bit option keeps the smooth gradients your adjustments produce. The source copy is 8-bit, so it adds no detail by itself.',
            )}
          </p>
        )}
        <Field label="Colour profile">
          <Segmented
            label="Colour profile"
            value={options.profile}
            onChange={(profile) => patch({ profile })}
            options={[
              { value: 'sRGB', label: 'sRGB' },
              { value: 'Display P3', label: 'Display P3' },
            ]}
          />
        </Field>
        {options.format === 'jpeg' && (
          <Field label="Background for transparency">
            <input
              type="color"
              value={options.background}
              onChange={(e) => patch({ background: e.target.value })}
              aria-label={t('Background colour')}
            />
          </Field>
        )}
        {options.format !== 'webp' && options.format !== 'avif' && (
          <Field label="Print resolution (DPI)">
            <input
              type="number"
              min={36}
              max={2400}
              placeholder={t('not set')}
              value={options.dpi ?? ''}
              onChange={(e) =>
                patch({ dpi: e.target.value ? Math.min(2400, Math.max(36, Number(e.target.value))) : null })
              }
            />
          </Field>
        )}
        <Check
          label="Keep camera info (make, model, exposure, date)"
          checked={options.keep_camera_info}
          onChange={(keep_camera_info) =>
            patch({ keep_camera_info, keep_gps: keep_camera_info && options.keep_gps })
          }
          hint="Only a short list of plain values captured at import. Nothing else from the original file."
        />
        <Check
          label="Include GPS location"
          checked={options.keep_gps}
          disabled={!options.keep_camera_info}
          onChange={(keep_gps) => patch({ keep_gps })}
        />
        <p className="hint">
          {t(
            'Metadata is removed when a file is imported. These options re-attach only the validated values listed above. Off by default.',
          )}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {done && (
          <p className="success" role="status">
            <Icon name="check" size={14} /> {t('Saved')} {done}
          </p>
        )}
        <div className="actions">
          <button type="button" className="button button-primary" disabled={busy} onClick={() => void run()}>
            <Icon name="export" size={15} /> {busy ? t('Rendering…') : t('Export')}
          </button>
          <button type="button" className="button" onClick={close}>
            {t('Close')}
          </button>
        </div>
      </div>
    </div>
  )
}

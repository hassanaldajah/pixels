import { useEffect, useRef, useState } from 'react'
import type { VideoCodec } from 'mediabunny'
import { useT } from '../../i18n'
import { Icon } from '../../components/Icon'
import {
  exportVideo,
  outputSize,
  RESOLUTIONS,
  supported,
  type ExportJob,
  type ResolutionId,
} from '../exporter'
import { lockSources } from '../media'
import { projectDuration } from '../model'
import { currentProject, useProject } from '../store'
import { formatTime } from './Workspace'

type Picker = (options: {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}) => Promise<FileSystemFileHandle>

/** Export the video: the size (only what this device can encode), then a save location, with progress. */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const project = useProject()
  const [codecs, setCodecs] = useState<Record<ResolutionId, VideoCodec | null> | null>(null)
  const [choice, setChoice] = useState<ResolutionId>('1080')
  const [progress, setProgress] = useState<number | null>(null)
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const job = useRef<ExportJob | null>(null)
  const started = useRef(0)
  const duration = projectDuration(project)

  useEffect(() => {
    let alive = true
    void supported(project).then((s) => {
      if (!alive) return
      setCodecs(s)
      // the best size this device can do, up to 1080p by default
      if (!s[choice]) setChoice((['1080', '720'] as ResolutionId[]).find((r) => s[r]) ?? '720')
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.width, project.height])

  const start = async () => {
    const codec = codecs?.[choice]
    if (!codec) return
    const short = RESOLUTIONS.find((r) => r.id === choice)!.short
    const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker
    let file: FileSystemFileHandle | null = null
    if (picker) {
      try {
        file = await picker({
          suggestedName: `${project.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'video'}.mp4`,
          types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
        })
      } catch {
        return // the save window was closed
      }
    }
    setState('running')
    setProgress(0)
    started.current = performance.now()
    lockSources(true)
    job.current = exportVideo(currentProject(), { short, codec, file }, setProgress)
    try {
      await job.current.done
      setState('done')
    } catch (e) {
      setState('error')
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      lockSources(false)
      job.current = null
    }
  }

  const elapsed = (performance.now() - started.current) / 1000
  const left = progress && progress > 0.02 ? (elapsed / progress) * (1 - progress) : null
  const size = (short: number) => outputSize(project, short)

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="dialog glass v-export" role="dialog" aria-modal="true" aria-labelledby="v-export-title">
        <div className="dialog-head">
          <h3 id="v-export-title">{t('Export video')}</h3>
          {state !== 'running' && (
            <button type="button" className="icon-button" aria-label={t('Close')} onClick={onClose}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
        <p className="hint">
          {t('{d} long, {fps} frames per second, MP4 at the highest quality.', {
            d: formatTime(duration, project.fps),
            fps: project.fps,
          })}
        </p>
        <div className="v-res-list" role="radiogroup" aria-label={t('Size')}>
          {RESOLUTIONS.map((r) => {
            const codec = codecs?.[r.id]
            const { width, height } = size(r.short)
            return (
              <label key={r.id} className="v-res" data-disabled={codecs !== null && !codec}>
                <input
                  type="radio"
                  name="v-res"
                  value={r.id}
                  checked={choice === r.id}
                  disabled={!codec || state === 'running'}
                  onChange={() => setChoice(r.id)}
                />
                <span className="v-res-name">{t(r.label)}</span>
                <span className="v-res-size" dir="ltr">
                  {width} × {height}
                </span>
                <span className="v-res-note">
                  {codecs === null
                    ? t('Checking…')
                    : codec
                      ? codec === 'hevc'
                        ? 'HEVC'
                        : 'H.264'
                      : t('This device cannot encode this size')}
                </span>
              </label>
            )
          })}
        </div>
        {state === 'running' && progress !== null && (
          <div className="v-export-progress" aria-live="polite">
            <div
              className="bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
            >
              <div className="bar-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span>
              {Math.round(progress * 100)}%
              {left !== null
                ? ` · ${t('about {s} left', { s: formatTime(left).replace(/\.\d+$/, '') })}`
                : ''}
            </span>
          </div>
        )}
        {state === 'done' && (
          <p className="hint" role="status">
            <Icon name="check" size={14} /> {t('The video is saved.')}
          </p>
        )}
        {state === 'error' && (
          <p className="hint hint-error" role="alert">
            {t('The export stopped: {reason}', { reason: error })}
          </p>
        )}
        <div className="dialog-actions">
          {state === 'running' ? (
            <button type="button" className="button" onClick={() => void job.current?.cancel()}>
              {t('Cancel')}
            </button>
          ) : (
            <button
              type="button"
              className="button button-primary"
              disabled={!codecs?.[choice] || duration <= 0}
              onClick={() => void start()}
            >
              <Icon name="export" size={15} /> {state === 'done' ? t('Export again') : t('Export')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

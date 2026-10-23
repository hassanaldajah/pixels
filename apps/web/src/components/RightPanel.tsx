import Lenis from 'lenis'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useT } from '../i18n'
import { useImage } from '../state/image'
import { useUi } from '../state/ui'
import { AdjustPanel } from './AdjustPanel'
import { BrushPanel } from './BrushPanel'
import { ClonePanel } from './ClonePanel'
import { EraserPanel } from './EraserPanel'
import { HistoryPanel } from './HistoryPanel'
import { LayersPanel } from './LayersPanel'
import { LocalPanel } from './LocalPanel'
import { SelectionPanel } from './SelectionPanel'
import { TextShapePanel } from './TextShapePanel'
import { Histogram } from './Histogram'
import { PixelArtPanel } from './PixelArtPanel'
import { PresetsPanel } from './PresetsPanel'
import { RetouchPanel } from './RetouchPanel'
import { UpscalePanel } from './UpscalePanel'
import { TransformPanel } from './TransformPanel'
import { GateSteps } from './GateSteps'
import { Icon } from './Icon'

function Section({
  title,
  children,
  defaultOpen = true,
  badge,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  badge?: string
}) {
  const t = useT()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="section">
      <button type="button" className="section-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon
          name={open ? 'chevronDown' : 'chevronRight'}
          size={14}
          className={open ? undefined : 'rtl-flip'}
        />
        <span>{t(title)}</span>
        {badge && <span className="badge">{badge}</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="section-body">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

const megapixels = (w: number, h: number) => `${((w * h) / 1e6).toFixed(w * h >= 1e7 ? 0 : 2)} MP`

interface StegoInfo {
  checked: boolean
  suspicious: boolean
  findings: string[]
  scrubbed: boolean
}

const asStego = (value: unknown): StegoInfo | null =>
  value && typeof value === 'object' && 'suspicious' in value ? (value as StegoInfo) : null
const asHash = (value: unknown): string | null =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null

function Properties() {
  const t = useT()
  const image = useImage((s) => s.current)
  if (!image) return <p className="muted">{t('Open an image to see its properties.')}</p>
  const meta = image.report.meta
  const gateMeta = image.report.gate.meta
  const stego = asStego(gateMeta.stego)
  const sha = asHash(gateMeta.sha256_original)
  return (
    <dl className="facts">
      <dt>{t('Name')}</dt>
      <dd title={image.name}>{image.name}</dd>
      <dt>{t('Size')}</dt>
      <dd>
        {image.width.toLocaleString('en-US')} × {image.height.toLocaleString('en-US')} px
      </dd>
      <dt>{t('Resolution')}</dt>
      <dd>{megapixels(image.width, image.height)}</dd>
      <dt>{t('Source')}</dt>
      <dd>
        {meta.source_format}
        {meta.frames > 1 ? ` (${t('frame 1 of {n}', { n: meta.frames })})` : ''}
      </dd>
      <dt>{t('Alpha')}</dt>
      <dd>{image.hasAlpha ? t('Yes') : t('No')}</dd>
      <dt>{t('Working copy')}</dt>
      <dd>{t('8-bit sRGB PNG')}</dd>
      <dt>{t('Metadata')}</dt>
      <dd>
        {meta.metadata_removed.length
          ? `${t('Removed')}: ${meta.metadata_removed.join(', ')}`
          : t('None found')}
      </dd>
      {stego && (
        <>
          <dt>{t('Hidden data')}</dt>
          <dd title={stego.findings.join(' ')}>
            {!stego.checked
              ? t('Not checked')
              : stego.suspicious
                ? stego.scrubbed
                  ? t('Looked suspicious, low bits cleaned')
                  : t('Looks suspicious')
                : stego.scrubbed
                  ? t('None found, low bits cleaned')
                  : t('None found')}
          </dd>
        </>
      )}
      {sha && (
        <>
          <dt>SHA-256</dt>
          <dd title={sha}>
            {sha.slice(0, 12)}…{' '}
            <a
              href={`https://www.virustotal.com/gui/file/${sha}`}
              target="_blank"
              rel="noopener noreferrer"
              title={t('Looks the hash up on VirusTotal. The picture is not uploaded.')}
            >
              VirusTotal
            </a>
          </dd>
        </>
      )}
    </dl>
  )
}

export function RightPanel() {
  const t = useT()
  const image = useImage((s) => s.current)
  const scroller = useRef<HTMLDivElement>(null)
  const set = useUi((s) => s.set)
  const tool = useUi((s) => s.tool)

  useEffect(() => {
    const wrapper = scroller.current
    const content = wrapper?.firstElementChild
    if (!wrapper || !(content instanceof HTMLElement)) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return
    const lenis = new Lenis({ wrapper, content, autoRaf: true, lerp: 0.12 })
    return () => lenis.destroy()
  }, [])

  return (
    <aside className="rightpanel glass" aria-label={t('Parameters')}>
      <div className="panel-head">
        <span>{t('Inspector')}</span>
        <button
          type="button"
          className="icon-button"
          aria-label={t('Hide panel')}
          title={t('Hide panel (Ctrl+])')}
          onClick={() => set({ rightOpen: false })}
        >
          <Icon name="close" size={15} />
        </button>
      </div>
      <div ref={scroller} className="panel-scroll">
        <div>
          {image && tool === 'transform' && <TransformPanel />}
          {image && tool === 'adjust' && <AdjustPanel />}
          {image && tool === 'eraser' && <EraserPanel />}
          {image && tool === 'brush' && <BrushPanel />}
          {image && tool === 'lasso' && (
            <div className="tool-panel">
              <div className="tool-panel-head">
                <h4>{t('Lasso')}</h4>
              </div>
              <p className="hint">
                {t(
                  'Drag around the area you want to edit; let go and the shape closes. Adjust edits then apply only inside it. Set the soft edge and Invert under Selection. Esc cancels a shape in progress.',
                )}
              </p>
            </div>
          )}
          {image && tool === 'move' && (
            <div className="tool-panel">
              <div className="tool-panel-head">
                <h4>{t('Move')}</h4>
              </div>
              <p className="hint">
                {t(
                  'Drag on the picture to move the selected layer (hold Shift for a straight line). Arrow keys nudge it. Pick the layer first in Layers.',
                )}
              </p>
            </div>
          )}
          {image && tool === 'clone' && <ClonePanel />}
          {image && tool === 'background' && <RetouchPanel />}
          {image && tool === 'upscale' && <UpscalePanel />}
          {image && tool === 'pixelart' && <PixelArtPanel />}
          {image && tool === 'presets' && <PresetsPanel />}
          <Section title="Image">
            <Properties />
          </Section>
          <Section title="Histogram">
            {image ? (
              <Histogram data={image.histogram} />
            ) : (
              <p className="muted">{t('Shown once an image is open.')}</p>
            )}
          </Section>
          <Section title="Security report">
            {image ? (
              <>
                <p className="verdict">
                  <Icon name="shield" size={15} /> {t(image.report.gate.verdict)}
                </p>
                <GateSteps steps={image.report.gate.steps} />
              </>
            ) : (
              <p className="muted">{t('Every file is checked on the backend before it is shown.')}</p>
            )}
          </Section>
          <Section title="Local adjustments" defaultOpen={false}>
            <LocalPanel />
          </Section>
          <Section title="Selection" defaultOpen={false}>
            <SelectionPanel />
          </Section>
          <Section title="Text & shapes" defaultOpen={false}>
            <TextShapePanel />
          </Section>
          <Section title="Layers" defaultOpen={false}>
            <LayersPanel />
          </Section>
          <Section title="History" defaultOpen>
            <HistoryPanel />
          </Section>
        </div>
      </div>
    </aside>
  )
}

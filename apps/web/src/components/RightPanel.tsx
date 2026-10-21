import Lenis from 'lenis'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useImage } from '../state/image'
import { useUi } from '../state/ui'
import { AdjustPanel } from './AdjustPanel'
import { EraserPanel } from './EraserPanel'
import { HistoryPanel } from './HistoryPanel'
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
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="section">
      <button type="button" className="section-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
        <span>{title}</span>
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

function Properties() {
  const image = useImage((s) => s.current)
  if (!image) return <p className="muted">Open an image to see its properties.</p>
  const meta = image.report.meta
  return (
    <dl className="facts">
      <dt>Name</dt>
      <dd title={image.name}>{image.name}</dd>
      <dt>Size</dt>
      <dd>
        {image.width.toLocaleString()} × {image.height.toLocaleString()} px
      </dd>
      <dt>Resolution</dt>
      <dd>{megapixels(image.width, image.height)}</dd>
      <dt>Source</dt>
      <dd>
        {meta.source_format}
        {meta.frames > 1 ? ` (frame 1 of ${meta.frames})` : ''}
      </dd>
      <dt>Alpha</dt>
      <dd>{image.hasAlpha ? 'Yes' : 'No'}</dd>
      <dt>Working copy</dt>
      <dd>8-bit sRGB PNG</dd>
      <dt>Metadata</dt>
      <dd>{meta.metadata_removed.length ? `Removed: ${meta.metadata_removed.join(', ')}` : 'None found'}</dd>
    </dl>
  )
}

export function RightPanel() {
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
    <aside className="rightpanel glass" aria-label="Parameters">
      <div className="panel-head">
        <span>Inspector</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Hide panel"
          title="Hide panel (Ctrl+])"
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
              <p className="muted">Shown once an image is open.</p>
            )}
          </Section>
          <Section title="Security report">
            {image ? (
              <>
                <p className="verdict">
                  <Icon name="shield" size={15} /> {image.report.gate.verdict}
                </p>
                <GateSteps steps={image.report.gate.steps} />
              </>
            ) : (
              <p className="muted">Every file is checked on the backend before it is shown.</p>
            )}
          </Section>
          <Section title="Layers & masks" defaultOpen={false} badge="Soon">
            <p className="muted">Masks arrive with the eraser and background tools.</p>
          </Section>
          <Section title="History" defaultOpen>
            <HistoryPanel />
          </Section>
        </div>
      </div>
    </aside>
  )
}

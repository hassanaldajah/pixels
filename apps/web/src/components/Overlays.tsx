import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { useSecurityStatus } from '../api/queries'
import { ACCEPT_ATTRIBUTE } from '../lib/precheck'
import { openFilePicker } from '../lib/shortcuts'
import { useImage } from '../state/image'
import { GateSteps } from './GateSteps'
import { Icon } from './Icon'

/** Hidden input behind every "Open" action. Selection goes straight through the Security Gate. */
export function FileInput() {
  const importFiles = useImage((s) => s.importFiles)
  return (
    <input
      id="pixels-file-input"
      type="file"
      accept={`${ACCEPT_ATTRIBUTE},.pxe`}
      multiple
      hidden
      onChange={(e) => {
        void importFiles([...(e.target.files ?? [])])
        e.target.value = ''
      }}
    />
  )
}

/** Drag-and-drop anywhere in the window, and paste from the clipboard. */
export function useIntake(setDragging: (on: boolean) => void): void {
  const importFiles = useImage((s) => s.importFiles)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      setDragging(true)
    }
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault()
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      void importFiles([...(e.dataTransfer?.files ?? [])])
    }
    const paste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])]
      if (files.length === 0) return
      e.preventDefault()
      void importFiles(files)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    window.addEventListener('paste', paste)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
      window.removeEventListener('paste', paste)
    }
  }, [importFiles, setDragging])
}

export function DropOverlay() {
  return (
    <div className="drop-overlay" role="presentation">
      <Icon name="upload" size={40} />
      <strong>Drop to open</strong>
      <span>Every file is checked before it is shown</span>
    </div>
  )
}

export function EmptyState() {
  const importing = useImage((s) => s.importing)
  const { data } = useSecurityStatus()
  return (
    <div className="empty">
      <div className="empty-card glass">
        <Icon name="image" size={34} />
        <h2>{importing ? 'Checking your image…' : 'Open an image to start'}</h2>
        <p>Drop a file anywhere, paste from the clipboard, or choose one.</p>
        <button type="button" className="button button-primary" onClick={openFilePicker} disabled={importing}>
          <Icon name="upload" size={15} /> Choose image
        </button>
        <ol className="steps" aria-label="How it works">
          <li>
            <strong>1</strong>
            <span>Open a picture</span>
          </li>
          <li>
            <strong>2</strong>
            <span>Edit it: crop, colour, curves</span>
          </li>
          <li>
            <strong>3</strong>
            <span>Export for web, print or app stores</span>
          </li>
        </ol>
        <p className="hint">PNG · JPEG · WebP · TIFF · BMP · HEIC · AVIF</p>
        <p className="hint">
          <Icon name="shield" size={13} /> Files are scanned, decoded in a sandbox and re-encoded before use
          {data && !data.clamav.available
            ? '. ClamAV is not running, so signature scanning is skipped.'
            : '.'}
        </p>
      </div>
    </div>
  )
}

export function Rejections() {
  const rejections = useImage((s) => s.rejections)
  const dismiss = useImage((s) => s.dismissRejection)
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence initial={false}>
        {rejections.map((r, i) => (
          <motion.div
            key={`${r.code}-${r.message}-${i}`}
            layout
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            className="toast toast-danger glass"
            role="alert"
          >
            <Icon name="shield" size={18} />
            <div className="toast-body">
              <strong>Not opened</strong>
              <p>{r.message}</p>
              {r.steps.length > 0 && <GateSteps steps={r.steps} />}
            </div>
            <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => dismiss(i)}>
              <Icon name="close" size={15} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function Notices() {
  const notices = useImage((s) => s.notices)
  const clear = useImage((s) => s.clearNotices)
  useEffect(() => {
    if (notices.length === 0) return
    const timer = window.setTimeout(clear, 9000)
    return () => window.clearTimeout(timer)
  }, [notices, clear])
  if (notices.length === 0) return null
  return (
    <div className="notices glass" role="status">
      <Icon name="warn" size={15} />
      <span>{notices.join(' ')}</span>
      <button type="button" className="icon-button" aria-label="Dismiss notice" onClick={clear}>
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}

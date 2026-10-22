import { useSecurityStatus } from '../api/queries'
import { AppIcon, Wordmark } from '../brand/Logo'
import { QUALITY, useUi, type Quality } from '../state/ui'
import { saveBlob, saveProject } from '../api/edit'
import { useEdit } from '../state/edit'
import { useImage } from '../state/image'
import { useView } from '../state/view'
import { formatZoom } from '../viewport/math'
import { toggleTheme, openFilePicker } from '../lib/shortcuts'
import { Icon } from './Icon'
import { Popover } from './Popover'

function ThemeToggle() {
  const theme = useUi((s) => s.theme)
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={`Switch to ${theme === 'dark' ? 'Light Studio' : 'Studio Dark'}`}
      title="Switch theme (Ctrl+Shift+L)"
      onClick={(e) => toggleTheme({ x: e.clientX, y: e.clientY })}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  )
}

function QualitySelect() {
  const quality = useUi((s) => s.quality)
  const set = useUi((s) => s.set)
  return (
    <label className="select-wrap" title={QUALITY[quality].hint}>
      <span className="sr-only">Quality</span>
      <select
        value={quality}
        onChange={(e) => set({ quality: e.target.value as Quality })}
        aria-label="Quality"
      >
        {Object.entries(QUALITY).map(([id, q]) => (
          <option key={id} value={id}>
            {q.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function SecurityIndicator() {
  const { data, isError } = useSecurityStatus()
  const state =
    isError || !data
      ? 'offline'
      : !data.yara.available
        ? 'degraded'
        : !data.clamav.available
          ? 'partial'
          : 'full'
  const label = {
    offline: 'Security: offline',
    degraded: 'Security: reduced',
    partial: 'Security checks on',
    full: 'Security: full',
  }[state]
  return (
    <Popover
      label="Security status"
      trigger={
        <>
          <Icon name="shield" size={15} className={`sec sec-${state}`} />
          {label}
        </>
      }
    >
      <h4>Pixels security</h4>
      {data ? (
        <ul className="status-list">
          <li data-ok="true">Magic-byte check, format allowlist, bomb and polyglot detection</li>
          <li data-ok="true">Sandboxed decoding ({data.sandbox.kind})</li>
          <li data-ok={data.yara.available}>
            YARA rules:{' '}
            {data.yara.available
              ? `${data.yara.rules} loaded`
              : `unavailable (${data.yara.error ?? 'unknown'})`}
          </li>
          <li data-ok={data.clamav.available}>
            ClamAV: {data.clamav.available ? 'connected' : 'not running'}
          </li>
          <li data-ok={data.sandbox.network_isolated}>
            OS network isolation for the decoder:{' '}
            {data.sandbox.network_isolated ? 'on' : 'no (socket block only)'}
          </li>
        </ul>
      ) : (
        <p>The backend is not reachable.</p>
      )}
      {data?.clamav.install_hint && <p className="hint">{data.clamav.install_hint}</p>}
      <p className="hint">Files are described as “passed Pixels security checks”, never as virus-free.</p>
    </Popover>
  )
}

function ZoomControl() {
  const zoom = useView((s) => s.target.zoom)
  const hasImage = useImage((s) => s.current !== null)
  const view = useView.getState
  return (
    <div className="zoom-control" role="group" aria-label="Zoom">
      <button
        type="button"
        className="icon-button"
        disabled={!hasImage}
        aria-label="Zoom out"
        title="Zoom out (Ctrl+-)"
        onClick={() => view().step(-1)}
      >
        <Icon name="minus" size={15} />
      </button>
      <button
        type="button"
        className="zoom-value"
        disabled={!hasImage}
        title="Actual size (Ctrl+1)"
        onClick={() => view().actualSize()}
      >
        {hasImage ? formatZoom(zoom) : '—'}
      </button>
      <button
        type="button"
        className="icon-button"
        disabled={!hasImage}
        aria-label="Zoom in"
        title="Zoom in (Ctrl+=)"
        onClick={() => view().step(1)}
      >
        <Icon name="plus" size={15} />
      </button>
      <button
        type="button"
        className="icon-button"
        disabled={!hasImage}
        aria-label="Fit to screen"
        title="Fit (Ctrl+0)"
        onClick={() => view().fit()}
      >
        <Icon name="fit" size={15} />
      </button>
    </div>
  )
}

function CompareControl() {
  const mode = useEdit((s) => s.compare.mode)
  const setCompare = useEdit((s) => s.setCompare)
  const hasImage = useImage((s) => s.current !== null)
  const options = [
    ['off', 'Edit'],
    ['split', 'Split'],
    ['side', 'Side'],
  ] as const
  return (
    <div
      className="segmented segmented-compact"
      role="radiogroup"
      aria-label="Compare before and after"
      title="Compare with the unedited picture. Hold the backslash key to flip."
    >
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          data-active={mode === value}
          disabled={!hasImage}
          onClick={() => setCompare({ mode: value })}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export async function saveCurrentProject(): Promise<void> {
  const image = useImage.getState().current
  if (!image) return
  const { history, index } = useEdit.getState()
  const name = image.name.replace(/[.][^.]+$/, '')
  const { blob, filename } = await saveProject(image.id, {
    format: 'pixels-project',
    version: 1,
    name,
    history,
    index,
  })
  saveBlob(blob, filename)
}

function UndoRedo() {
  const index = useEdit((s) => s.index)
  const length = useEdit((s) => s.history.length)
  const undo = useEdit((s) => s.undo)
  const redo = useEdit((s) => s.redo)
  return (
    <>
      <button
        type="button"
        className="icon-button"
        disabled={index === 0}
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
        onClick={undo}
      >
        <Icon name="undo" />
      </button>
      <button
        type="button"
        className="icon-button"
        disabled={index >= length - 1}
        aria-label="Redo"
        title="Redo (Ctrl+Shift+Z)"
        onClick={redo}
      >
        <Icon name="redo" />
      </button>
    </>
  )
}

export function TopBar() {
  const image = useImage((s) => s.current)
  const set = useUi((s) => s.set)
  return (
    <header className="topbar glass">
      <div className="brand" title="pixels">
        <AppIcon size={30} />
        <Wordmark height={17} />
      </div>
      <div className="project" title={image?.name}>
        {image ? image.name : 'No image open'}
      </div>
      <div className="topbar-spacer" />
      <UndoRedo />
      <CompareControl />
      <span className="divider" />
      <ZoomControl />
      <span className="divider" />
      <QualitySelect />
      <SecurityIndicator />
      <button
        type="button"
        className="icon-button"
        aria-label="Command palette"
        title="Command palette (Ctrl+K)"
        onClick={() => set({ paletteOpen: true })}
      >
        <Icon name="command" />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="User guide"
        title="User guide (F1)"
        onClick={() => set({ guideOpen: true })}
      >
        <Icon name="help" />
      </button>
      <ThemeToggle />
      <button type="button" className="button" onClick={openFilePicker}>
        <Icon name="upload" size={15} /> Open
      </button>
      <button
        type="button"
        className="button"
        disabled={!image}
        onClick={() => void saveCurrentProject()}
        title="Save the picture and its edit history as a .pxe project (Ctrl+S)"
      >
        Save<span className="hide-narrow"> project</span>
      </button>
      <button
        type="button"
        className="button button-primary"
        disabled={!image}
        onClick={() => set({ exportOpen: true })}
        title="Export (Ctrl+E)"
      >
        <Icon name="export" size={15} /> Export
      </button>
    </header>
  )
}

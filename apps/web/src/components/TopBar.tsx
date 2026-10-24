import { useSecurityStatus } from '../api/queries'
import { useLang, useT } from '../i18n'
import { AppIcon, Wordmark } from '../brand/Logo'
import { QUALITY, useUi, type Quality } from '../state/ui'
import { saveBlob, saveProject } from '../api/edit'
import { useEdit } from '../state/edit'
import { useImage } from '../state/image'
import { useView } from '../state/view'
import { emptyProject } from '../video/model'
import { useVideo } from '../video/store'
import { formatZoom } from '../viewport/math'
import { toggleTheme, openFilePicker } from '../lib/shortcuts'
import { Icon } from './Icon'
import { Popover } from './Popover'
import { useTour } from './Tour'

function LanguageToggle() {
  const lang = useLang((s) => s.lang)
  const setLang = useLang((s) => s.setLang)
  return (
    <button
      type="button"
      className="icon-button lang-toggle"
      lang={lang === 'ar' ? 'en' : 'ar'}
      aria-label={lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
      title={lang === 'ar' ? 'English' : 'العربية'}
      onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
    >
      {lang === 'ar' ? 'EN' : 'ع'}
    </button>
  )
}

function ThemeToggle() {
  const t = useT()
  const theme = useUi((s) => s.theme)
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={t(theme === 'dark' ? 'Switch to Light Studio' : 'Switch to Studio Dark')}
      title={t('Switch theme (Ctrl+Shift+L)')}
      onClick={(e) => toggleTheme({ x: e.clientX, y: e.clientY })}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  )
}

function QualitySelect() {
  const t = useT()
  const quality = useUi((s) => s.quality)
  const set = useUi((s) => s.set)
  return (
    <label className="select-wrap" title={t(QUALITY[quality].hint)}>
      <span className="sr-only">{t('Quality')}</span>
      <select
        value={quality}
        onChange={(e) => set({ quality: e.target.value as Quality })}
        aria-label={t('Quality')}
      >
        {Object.entries(QUALITY).map(([id, q]) => (
          <option key={id} value={id}>
            {t(q.label)}
          </option>
        ))}
      </select>
    </label>
  )
}

function SecurityIndicator() {
  const t = useT()
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
    offline: t('Security: offline'),
    degraded: t('Security: reduced'),
    partial: t('Security checks on'),
    full: t('Security: full'),
  }[state]
  return (
    <Popover
      label={t('Security status')}
      trigger={
        <>
          <Icon name="shield" size={15} className={`sec sec-${state}`} />
          {label}
        </>
      }
    >
      <h4>{t('Pixels security')}</h4>
      {data ? (
        <ul className="status-list">
          <li data-ok="true">{t('Magic-byte check, format allowlist, bomb and polyglot detection')}</li>
          <li data-ok="true">
            {t('Sandboxed decoding')} ({data.sandbox.kind})
          </li>
          <li data-ok={data.yara.available}>
            {t('YARA rules')}:{' '}
            {data.yara.available
              ? t('{n} loaded', { n: data.yara.rules })
              : t('unavailable ({reason})', { reason: data.yara.error ?? t('unknown') })}
          </li>
          <li data-ok={data.clamav.available}>
            ClamAV: {data.clamav.available ? t('connected') : t('not running')}
          </li>
          <li data-ok={data.sandbox.network_isolated}>
            {t('OS network isolation for the decoder')}:{' '}
            {data.sandbox.network_isolated ? t('on') : t('no (socket block only)')}
          </li>
        </ul>
      ) : (
        <p>{t('The backend is not reachable.')}</p>
      )}
      {data?.clamav.install_hint && <p className="hint">{t(data.clamav.install_hint)}</p>}
      <p className="hint">
        {t('Files are described as “passed Pixels security checks”, never as virus-free.')}
      </p>
    </Popover>
  )
}

function ZoomControl() {
  const t = useT()
  const zoom = useView((s) => s.target.zoom)
  const hasImage = useImage((s) => s.current !== null)
  const view = useView.getState
  return (
    <div className="zoom-control" role="group" aria-label={t('Zoom')} data-tour="view">
      <button
        type="button"
        className="icon-button"
        disabled={!hasImage}
        aria-label={t('Zoom out')}
        title={t('Zoom out (Ctrl+-)')}
        onClick={() => view().step(-1)}
      >
        <Icon name="minus" size={15} />
      </button>
      <button
        type="button"
        className="zoom-value"
        disabled={!hasImage}
        title={t('Actual size (Ctrl+1)')}
        onClick={() => view().actualSize()}
      >
        {hasImage ? formatZoom(zoom) : '—'}
      </button>
      <button
        type="button"
        className="icon-button"
        disabled={!hasImage}
        aria-label={t('Zoom in')}
        title={t('Zoom in (Ctrl+=)')}
        onClick={() => view().step(1)}
      >
        <Icon name="plus" size={15} />
      </button>
      <button
        type="button"
        className="icon-button"
        disabled={!hasImage}
        aria-label={t('Fit to screen')}
        title={t('Fit (Ctrl+0)')}
        onClick={() => view().fit()}
      >
        <Icon name="fit" size={15} />
      </button>
    </div>
  )
}

function CompareControl() {
  const t = useT()
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
      aria-label={t('Compare before and after')}
      title={t('Compare with the unedited picture. Hold the backslash key to flip.')}
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
          {t(label)}
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
  const t = useT()
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
        aria-label={t('Undo')}
        title={t('Undo (Ctrl+Z)')}
        onClick={undo}
      >
        <Icon name="undo" />
      </button>
      <button
        type="button"
        className="icon-button"
        disabled={index >= length - 1}
        aria-label={t('Redo')}
        title={t('Redo (Ctrl+Shift+Z)')}
        onClick={redo}
      >
        <Icon name="redo" />
      </button>
    </>
  )
}

/** Photos or video: the two editors share the window, the theme, the language and the security checks. */
function ModeSwitch() {
  const t = useT()
  const mode = useUi((s) => s.mode)
  const set = useUi((s) => s.set)
  return (
    <div className="segmented segmented-compact mode-switch" role="radiogroup" aria-label={t('Editor')}>
      {(
        [
          ['photo', 'Photos', 'image'],
          ['video', 'Video', 'film'],
        ] as const
      ).map(([value, label, icon]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          data-active={mode === value}
          onClick={() => set({ mode: value })}
        >
          <Icon name={icon} size={14} /> {t(label)}
        </button>
      ))}
    </div>
  )
}

function VideoTopControls() {
  const t = useT()
  const index = useVideo((s) => s.index)
  const length = useVideo((s) => s.history.length)
  const label = useVideo((s) => s.history[s.index]?.label ?? '')
  return (
    <>
      <div className="topbar-spacer" />
      <button
        type="button"
        className="button"
        title={t('Start a new video; this one stays in the recent list')}
        onClick={() => useVideo.getState().open(emptyProject(t('Untitled video')), 'New video')}
      >
        <Icon name="plus" size={14} /> {t('New video')}
      </button>
      <span className="v-last-step" title={t('Last change')}>
        {t(label)}
      </span>
      <button
        type="button"
        className="icon-button"
        disabled={index === 0}
        aria-label={t('Undo')}
        title={t('Undo (Ctrl+Z)')}
        onClick={() => useVideo.getState().undo()}
      >
        <Icon name="undo" />
      </button>
      <button
        type="button"
        className="icon-button"
        disabled={index >= length - 1}
        aria-label={t('Redo')}
        title={t('Redo (Ctrl+Shift+Z)')}
        onClick={() => useVideo.getState().redo()}
      >
        <Icon name="redo" />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={t('Show the tour')}
        title={t('Show the tour')}
        onClick={() => useTour.getState().start('video')}
      >
        <Icon name="help" />
      </button>
      <span className="divider" />
      <SecurityIndicator />
      <LanguageToggle />
      <ThemeToggle />
      <button
        type="button"
        className="button button-primary"
        onClick={() => {
          if (useVideo.getState().playing) window.dispatchEvent(new Event('pixels-video-toggle'))
          useVideo.getState().set({ exportOpen: true })
        }}
        title={t('Export the video')}
        data-tour="video-export"
      >
        <Icon name="export" size={15} /> {t('Export')}
      </button>
    </>
  )
}

export function TopBar() {
  const t = useT()
  const image = useImage((s) => s.current)
  const set = useUi((s) => s.set)
  const mode = useUi((s) => s.mode)
  if (mode === 'video')
    return (
      <header className="topbar glass">
        <div className="brand" title="pixels">
          <AppIcon size={30} />
          <Wordmark height={17} />
        </div>
        <ModeSwitch />
        <VideoTopControls />
      </header>
    )
  return (
    <header className="topbar glass">
      <div className="brand" title="pixels">
        <AppIcon size={30} />
        <Wordmark height={17} />
      </div>
      <ModeSwitch />
      <div className="project" title={image?.name}>
        {image ? image.name : t('No image open')}
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
        aria-label={t('Command palette')}
        title={t('Command palette (Ctrl+K)')}
        onClick={() => set({ paletteOpen: true })}
      >
        <Icon name="command" />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={t('User guide')}
        title={t('User guide (F1)')}
        data-tour="help"
        onClick={() => set({ guideOpen: true })}
      >
        <Icon name="help" />
      </button>
      <LanguageToggle />
      <ThemeToggle />
      <button type="button" className="button" onClick={openFilePicker} data-tour="open">
        <Icon name="upload" size={15} /> {t('Open')}
      </button>
      <button
        type="button"
        className="button"
        disabled={!image}
        onClick={() => void saveCurrentProject()}
        title={t('Save the picture and its edit history as a .pxe project (Ctrl+S)')}
      >
        {t('Save')}
        <span className="hide-narrow"> {t('project')}</span>
      </button>
      <button
        type="button"
        className="button button-primary"
        disabled={!image}
        onClick={() => set({ exportOpen: true })}
        title={t('Export (Ctrl+E)')}
        data-tour="export"
      >
        <Icon name="export" size={15} /> {t('Export')}
      </button>
    </header>
  )
}

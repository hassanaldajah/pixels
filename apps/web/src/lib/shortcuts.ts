import { useEdit } from '../state/edit'
import { useImage } from '../state/image'
import { useUi } from '../state/ui'
import { useView } from '../state/view'
import { TOOLS, toolAvailable } from './tools'
import { runThemeWipe } from './themeWipe'

export interface Command {
  id: string
  title: string
  keys?: string
  group: 'View' | 'Tools' | 'File' | 'Panels' | 'Help'
  enabled?: () => boolean
  run: () => void
}

const hasImage = () => useImage.getState().current !== null

export function toggleTheme(origin?: { x: number; y: number }): void {
  const ui = useUi.getState()
  const next = ui.theme === 'dark' ? 'light' : 'dark'
  runThemeWipe(origin ?? { x: window.innerWidth - 140, y: 24 }, () => ui.set({ theme: next }))
}

export function openFilePicker(): void {
  document.getElementById('pixels-file-input')?.click()
}

export const COMMANDS: Command[] = [
  {
    id: 'undo',
    title: 'Undo',
    keys: 'Ctrl+Z',
    group: 'File',
    enabled: () => useEdit.getState().index > 0,
    run: () => useEdit.getState().undo(),
  },
  {
    id: 'redo',
    title: 'Redo',
    keys: 'Ctrl+Shift+Z',
    group: 'File',
    enabled: () => {
      const e = useEdit.getState()
      return e.index < e.history.length - 1
    },
    run: () => useEdit.getState().redo(),
  },
  {
    id: 'save-project',
    title: 'Save project (.pxe)',
    keys: 'Ctrl+S',
    group: 'File',
    enabled: hasImage,
    run: () => {
      void import('../components/TopBar').then((m) => m.saveCurrentProject())
    },
  },
  {
    id: 'export',
    title: 'Export…',
    keys: 'Ctrl+E',
    group: 'File',
    enabled: hasImage,
    run: () => useUi.getState().set({ exportOpen: true }),
  },
  {
    id: 'compare-split',
    title: 'Compare: split view',
    group: 'View',
    enabled: hasImage,
    run: () =>
      useEdit.getState().setCompare({ mode: useEdit.getState().compare.mode === 'split' ? 'off' : 'split' }),
  },
  {
    id: 'compare-side',
    title: 'Compare: side by side',
    group: 'View',
    enabled: hasImage,
    run: () =>
      useEdit.getState().setCompare({ mode: useEdit.getState().compare.mode === 'side' ? 'off' : 'side' }),
  },
  { id: 'open', title: 'Open image…', keys: 'Ctrl+O', group: 'File', run: openFilePicker },
  {
    id: 'close',
    title: 'Close image',
    keys: 'Ctrl+W',
    group: 'File',
    enabled: hasImage,
    run: () => useImage.getState().close(),
  },
  {
    id: 'zoom-in',
    title: 'Zoom in',
    keys: 'Ctrl+=',
    group: 'View',
    enabled: hasImage,
    run: () => useView.getState().step(1),
  },
  {
    id: 'zoom-out',
    title: 'Zoom out',
    keys: 'Ctrl+-',
    group: 'View',
    enabled: hasImage,
    run: () => useView.getState().step(-1),
  },
  {
    id: 'fit',
    title: 'Fit to screen',
    keys: 'Ctrl+0',
    group: 'View',
    enabled: hasImage,
    run: () => useView.getState().fit(),
  },
  {
    id: 'actual',
    title: 'Actual size (100%)',
    keys: 'Ctrl+1',
    group: 'View',
    enabled: hasImage,
    run: () => useView.getState().actualSize(),
  },
  {
    id: 'rulers',
    title: 'Toggle rulers',
    keys: 'Ctrl+R',
    group: 'View',
    run: () => useUi.getState().set({ rulers: !useUi.getState().rulers }),
  },
  {
    id: 'thirds',
    title: 'Toggle rule-of-thirds grid',
    keys: "Ctrl+'",
    group: 'View',
    run: () => useUi.getState().set({ thirds: !useUi.getState().thirds }),
  },
  {
    id: 'grid',
    title: 'Toggle custom grid',
    keys: 'Ctrl+;',
    group: 'View',
    run: () => useUi.getState().set({ customGrid: !useUi.getState().customGrid }),
  },
  {
    id: 'clear-guides',
    title: 'Clear guides',
    group: 'View',
    enabled: hasImage,
    run: () => useView.getState().clearGuides(),
  },
  {
    id: 'theme',
    title: 'Switch theme (Studio Dark / Light Studio)',
    keys: 'Ctrl+Shift+L',
    group: 'View',
    run: () => toggleTheme(),
  },
  {
    id: 'right',
    title: 'Toggle right panel',
    keys: 'Ctrl+]',
    group: 'Panels',
    run: () => useUi.getState().set({ rightOpen: !useUi.getState().rightOpen }),
  },
  {
    id: 'dock',
    title: 'Toggle bottom dock',
    keys: 'Ctrl+J',
    group: 'Panels',
    run: () => useUi.getState().set({ dockOpen: !useUi.getState().dockOpen }),
  },
  {
    id: 'palette',
    title: 'Command palette',
    keys: 'Ctrl+K',
    group: 'Help',
    run: () => useUi.getState().set({ paletteOpen: true }),
  },
  {
    id: 'help',
    title: 'Keyboard shortcuts',
    keys: '?',
    group: 'Help',
    run: () => useUi.getState().set({ helpOpen: true }),
  },
  ...TOOLS.map<Command>((tool) => ({
    id: `tool-${tool.id}`,
    title: `${tool.label} tool${toolAvailable(tool) ? '' : ' (coming soon)'}`,
    keys: tool.shortcut,
    group: 'Tools',
    enabled: () => toolAvailable(tool),
    run: () => useUi.getState().set({ tool: tool.id }),
  })),
]

/** Only fields that take typed text swallow shortcuts; a focused slider or checkbox does not. */
export function takesText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true
  return (
    target instanceof HTMLInputElement &&
    !['range', 'checkbox', 'radio', 'button', 'color', 'submit', 'file'].includes(target.type)
  )
}

const isTyping = (e: KeyboardEvent): boolean => takesText(e.target)

/** Maps a keyboard event to a command id, or null. Exported for tests. */
export function commandForKey(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
): string | null {
  const mod = e.ctrlKey || e.metaKey
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (mod && !e.altKey) {
    if (e.shiftKey && key === 'l') return 'theme'
    if (key === 'z') return e.shiftKey ? 'redo' : 'undo'
    if (key === 'y') return 'redo'
    if (key === 's') return 'save-project'
    if (key === 'e') return 'export'
    if (key === 'k') return 'palette'
    if (key === 'o') return 'open'
    if (key === 'w') return 'close'
    if (key === '=' || key === '+') return 'zoom-in'
    if (key === '-' || key === '_') return 'zoom-out'
    if (key === '0') return 'fit'
    if (key === '1') return 'actual'
    if (key === 'r') return 'rulers'
    if (key === "'") return 'thirds'
    if (key === ';') return 'grid'
    if (key === ']') return 'right'
    if (key === 'j') return 'dock'
    return null
  }
  if (e.altKey || e.ctrlKey || e.metaKey) return null
  if (key === '?') return 'help'
  const tool = TOOLS.find((t) => t.shortcut.toLowerCase() === key)
  return tool ? `tool-${tool.id}` : null
}

export function installShortcuts(): () => void {
  const handler = (e: KeyboardEvent) => {
    if (isTyping(e) || (e.repeat && !(e.ctrlKey || e.metaKey))) return
    const id = commandForKey(e)
    if (!id) return
    const command = COMMANDS.find((c) => c.id === id)
    if (!command || (command.enabled && !command.enabled())) return
    e.preventDefault()
    command.run()
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}

import { useT } from '../i18n'
import { TOOLS, toolAvailable } from '../lib/tools'
import { useUi } from '../state/ui'
import { Icon } from './Icon'

export function ToolRail() {
  const t = useT()
  const tool = useUi((s) => s.tool)
  const set = useUi((s) => s.set)
  return (
    <nav className="toolrail glass" aria-label={t('Tools')}>
      {TOOLS.map((tl) => {
        const available = toolAvailable(tl)
        const reason = available ? t(tl.description) : `${t(tl.description)} ${t('Coming soon.')}`
        return (
          <button
            key={tl.id}
            type="button"
            className="tool"
            data-active={tool === tl.id}
            aria-pressed={tool === tl.id}
            aria-disabled={!available}
            title={`${t(tl.label)} (${tl.shortcut}): ${reason}`}
            onClick={() => available && set({ tool: tl.id })}
          >
            <Icon name={tl.icon} size={23} />
            <span className="tool-label">{t(tl.label)}</span>
            {!available && <span className="tool-phase">{t('Soon')}</span>}
          </button>
        )
      })}
    </nav>
  )
}

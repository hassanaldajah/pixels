import { TOOLS, toolAvailable } from '../lib/tools'
import { useUi } from '../state/ui'
import { Icon } from './Icon'

export function ToolRail() {
  const tool = useUi((s) => s.tool)
  const set = useUi((s) => s.set)
  return (
    <nav className="toolrail glass" aria-label="Tools">
      {TOOLS.map((t) => {
        const available = toolAvailable(t)
        const reason = available ? t.description : `${t.description} Coming soon.`
        return (
          <button
            key={t.id}
            type="button"
            className="tool"
            data-active={tool === t.id}
            aria-pressed={tool === t.id}
            aria-disabled={!available}
            title={`${t.label} (${t.shortcut}): ${reason}`}
            onClick={() => available && set({ tool: t.id })}
          >
            <Icon name={t.icon} size={23} />
            <span className="tool-label">{t.label}</span>
            {!available && <span className="tool-phase">Soon</span>}
          </button>
        )
      })}
    </nav>
  )
}

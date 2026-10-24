import { useEffect, useRef } from 'react'
import { useT } from '../i18n'
import { TOOLS, toolAvailable } from '../lib/tools'
import { useUi } from '../state/ui'
import { Icon } from './Icon'

/** Marks which end of a scrolling rail has more tools, so CSS can fade that edge. */
function useMoreIndicator(ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const before = el.scrollTop > 2
      const after = el.scrollTop + el.clientHeight < el.scrollHeight - 2
      const more = before && after ? 'both' : before ? 'start' : after ? 'end' : ''
      if (more) el.dataset.more = more
      else delete el.dataset.more
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    el.addEventListener('scroll', update, { passive: true })
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [ref])
}

export function ToolRail() {
  const t = useT()
  const tool = useUi((s) => s.tool)
  const set = useUi((s) => s.set)
  const rail = useRef<HTMLElement>(null)
  useMoreIndicator(rail)
  return (
    <nav ref={rail} className="toolrail glass" aria-label={t('Tools')}>
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
            onClick={(e) => {
              if (!available) return
              set({ tool: tl.id })
              e.currentTarget.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
            }}
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

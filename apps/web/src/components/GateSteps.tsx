import type { GateStep } from '../api/types'
import { useT } from '../i18n'
import { Icon } from './Icon'

const ICON = { passed: 'check', partial: 'warn', failed: 'close', pending: 'minus' } as const

export function GateSteps({ steps }: { steps: GateStep[] }) {
  const t = useT()
  return (
    <ol className="gate-steps">
      {steps.map((s) => (
        <li key={s.id} data-status={s.status}>
          <Icon name={ICON[s.status]} size={14} />
          <span className="gate-label">{t(s.label)}</span>
          {s.detail && <span className="gate-detail">{t(s.detail)}</span>}
        </li>
      ))}
    </ol>
  )
}

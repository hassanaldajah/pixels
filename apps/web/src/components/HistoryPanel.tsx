import { useEdit } from '../state/edit'
import { Icon } from './Icon'

/** Every committed edit, newest at the bottom. Click one to jump straight back to that state. */
export function HistoryPanel() {
  const history = useEdit((s) => s.history)
  const index = useEdit((s) => s.index)
  const jump = useEdit((s) => s.jump)
  return (
    <ol className="history" aria-label="Edit history">
      {history.map((entry, i) => (
        <li key={`${i}-${entry.label}`} data-active={i === index} data-future={i > index}>
          <button type="button" onClick={() => jump(i)} aria-current={i === index ? 'step' : undefined}>
            <span className="history-index">{i}</span>
            <span className="history-label">{entry.label}</span>
            {i === index && <Icon name="check" size={13} />}
          </button>
        </li>
      ))}
    </ol>
  )
}

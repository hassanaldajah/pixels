import { useId, useState, type ReactNode } from 'react'

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  /** The value the slider returns to on double-click. */
  neutral?: number
  unit?: string
  digits?: number
  /** Called continuously while dragging (no history entry). */
  onPreview: (value: number) => void
  /** Called once when the drag ends or a number is typed. */
  onCommit: (value: number) => void
}

/** A slider that previews live and commits once on release. Double-click resets it. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  neutral = 0,
  unit = '',
  digits = 0,
  onPreview,
  onCommit,
}: SliderProps) {
  const id = useId()
  const [dragging, setDragging] = useState(false)
  const percent = ((value - min) / (max - min)) * 100
  const origin = ((neutral - min) / (max - min)) * 100
  const fill =
    percent >= origin
      ? { left: `${origin}%`, width: `${percent - origin}%` }
      : { left: `${percent}%`, width: `${origin - percent}%` }
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  return (
    <div className="slider" data-dragging={dragging} data-changed={value !== neutral}>
      <label htmlFor={id}>{label}</label>
      <input
        className="slider-number"
        type="number"
        aria-label={`${label} value`}
        value={Number(value.toFixed(digits))}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number.parseFloat(e.target.value)
          if (Number.isFinite(v)) onCommit(clamp(v))
        }}
      />
      {unit && <span className="slider-unit">{unit}</span>}
      <div className="slider-track" onDoubleClick={() => onCommit(neutral)}>
        <div className="slider-fill" style={fill} />
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onPreview(Number.parseFloat(e.target.value))}
          onPointerDown={() => setDragging(true)}
          onPointerUp={(e) => {
            setDragging(false)
            onCommit(Number.parseFloat((e.target as HTMLInputElement).value))
          }}
          onKeyUp={(e) =>
            ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(
              e.key,
            ) && onCommit(Number.parseFloat((e.target as HTMLInputElement).value))
          }
          title="Double-click to reset"
        />
      </div>
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          title={o.title}
          data-active={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Check({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  hint?: string
}) {
  return (
    <label className="check" data-disabled={disabled} title={hint}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function Group({
  title,
  children,
  actions,
}: {
  title: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="group">
      <div className="group-head">
        <h5>{title}</h5>
        {actions}
      </div>
      {children}
    </div>
  )
}

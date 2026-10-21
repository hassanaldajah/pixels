import { useEffect, useRef, useState, type ReactNode } from 'react'

/** A small anchored popover that closes on outside click or Escape. */
export function Popover({
  trigger,
  children,
  align = 'right',
  label,
}: {
  trigger: ReactNode
  children: ReactNode
  align?: 'left' | 'right'
  label: string
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape)
    }
  }, [open])
  return (
    <div ref={box} className="popover-anchor">
      <button
        type="button"
        className="chip"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open && (
        <div role="dialog" aria-label={label} className={`popover glass popover-${align}`}>
          {children}
        </div>
      )}
    </div>
  )
}

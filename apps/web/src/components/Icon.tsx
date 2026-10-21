const PATHS = {
  select: ['M5 3l14 8-6.2 1.8L10.5 19 5 3z'],
  transform: ['M6 2v14a2 2 0 0 0 2 2h14', 'M2 6h14a2 2 0 0 1 2 2v14'],
  adjust: [
    'M4 6h10',
    'M18 6h2',
    'M4 12h4',
    'M12 12h8',
    'M4 18h12',
    'M20 18h0',
    'M16 4v4',
    'M10 10v4',
    'M18 16v4',
  ],
  eraser: [
    'M7 21h10',
    'M5.5 13.5l7-7a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L11 19H8l-2.5-2.5a2 2 0 0 1 0-3z',
    'M9 10l5 5',
  ],
  background: ['M4 5h16v14H4z', 'M4 15l4.5-4.5 3.5 3.5 3-3 5 5', 'M9 9.5h.01'],
  pixelart: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h3v3h-3z', 'M17 17h3v3h-3z'],
  upscale: ['M14 4h6v6', 'M20 4l-7 7', 'M10 20H4v-6', 'M4 20l7-7'],
  presets: ['M12 3l9 5-9 5-9-5 9-5z', 'M3 13l9 5 9-5', 'M3 17.5l9 5 9-5'],
  undo: ['M9 14L4 9l5-5', 'M4 9h9a6 6 0 0 1 0 12h-3'],
  redo: ['M15 14l5-5-5-5', 'M20 9h-9a6 6 0 0 0 0 12h3'],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'M12 2v2',
    'M12 20v2',
    'M4.9 4.9l1.4 1.4',
    'M17.7 17.7l1.4 1.4',
    'M2 12h2',
    'M20 12h2',
    'M4.9 19.1l1.4-1.4',
    'M17.7 6.3l1.4-1.4',
  ],
  moon: ['M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z'],
  export: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 19h16'],
  shield: ['M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6l8-3z'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  warn: ['M12 4l9 16H3L12 4z', 'M12 10v4', 'M12 17h.01'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  fit: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
  chevronDown: ['M6 9l6 6 6-6'],
  chevronRight: ['M9 6l6 6-6 6'],
  panelRight: ['M4 5h16v14H4z', 'M14 5v14'],
  dock: ['M4 5h16v14H4z', 'M4 14h16'],
  command: ['M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6z'],
  grid: ['M4 4h16v16H4z', 'M9.3 4v16', 'M14.7 4v16', 'M4 9.3h16', 'M4 14.7h16'],
  ruler: ['M3 8h18v8H3z', 'M7 8v3', 'M11 8v4', 'M15 8v3', 'M19 8v4'],
  image: ['M4 5h16v14H4z', 'M4 15l4.5-4.5 3.5 3.5 3-3 5 5', 'M9 9.5h.01'],
  lock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  upload: ['M12 16V4', 'M7 9l5-5 5 5', 'M4 19h16'],
  trash: ['M5 7h14', 'M10 7V4h4v3', 'M7 7l1 13h8l1-13'],
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

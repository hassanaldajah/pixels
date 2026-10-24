import { useT } from '../../i18n'

/**
 * Where each app draws its buttons and captions over a vertical video, as fractions of the frame
 * (approximate: the apps move them between versions). Keep faces and text out of these areas.
 */
export const PLATFORMS = {
  tiktok: {
    label: 'TikTok',
    zones: [
      { name: 'Top bar', x: 0, y: 0, w: 1, h: 0.12 },
      { name: 'Buttons', x: 0.84, y: 0.36, w: 0.16, h: 0.5 },
      { name: 'Caption and music', x: 0, y: 0.8, w: 0.84, h: 0.2 },
    ],
  },
  reels: {
    label: 'Instagram Reels',
    zones: [
      { name: 'Top bar', x: 0, y: 0, w: 1, h: 0.1 },
      { name: 'Buttons', x: 0.85, y: 0.45, w: 0.15, h: 0.45 },
      { name: 'Caption and music', x: 0, y: 0.78, w: 0.85, h: 0.22 },
    ],
  },
  shorts: {
    label: 'YouTube Shorts',
    zones: [
      { name: 'Top bar', x: 0, y: 0, w: 1, h: 0.09 },
      { name: 'Buttons', x: 0.86, y: 0.4, w: 0.14, h: 0.5 },
      { name: 'Title and channel', x: 0, y: 0.75, w: 0.86, h: 0.25 },
    ],
  },
} as const
export type Platform = keyof typeof PLATFORMS

export function SafeZones({ platform }: { platform: Platform }) {
  const t = useT()
  return (
    <div className="v-zones" aria-hidden="true">
      {PLATFORMS[platform].zones.map((z) => (
        <div
          key={z.name}
          className="v-zone"
          data-tall={z.w < 0.3}
          style={{
            left: `${z.x * 100}%`,
            top: `${z.y * 100}%`,
            width: `${z.w * 100}%`,
            height: `${z.h * 100}%`,
          }}
        >
          <span>{t(z.name)}</span>
        </div>
      ))}
    </div>
  )
}

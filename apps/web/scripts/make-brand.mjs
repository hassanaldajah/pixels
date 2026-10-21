/**
 * Builds the brand assets from the supplied logo (brand/source/logo-original.png):
 *   1. traces the "pixels" wordmark into vector paths (imagetracerjs: no dependencies),
 *   2. writes src/brand/wordmark.generated.ts (used by the <Logo> component),
 *   3. writes public/logo.svg and public/icon.svg (upright squircle app icon),
 *   4. rasterises the PNG icon set (favicons, apple-touch, 512, 1024) from that vector icon.
 * Run: pnpm --filter @pixels/web brand
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import ImageTracer from 'imagetracerjs'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.resolve(root, '../../brand/source/logo-original.png')
const publicDir = path.join(root, 'public')
const BLUE = '#0089f5' // sampled from the logo
const NAVY = '#020b20'
const NAVY_LIFT = '#0a2260'

// Regions in the 2048x2048 original (measured on the artwork).
const WORD = { left: 395, top: 690, width: 1340, height: 590 }
const LETTER_P = { left: 410, top: 820, width: 320, height: 450 }

const SUPERSAMPLE = 4
const SMOOTHING = 3.2 // Gaussian sigma in supersampled pixels (about 0.8 px of the original)

async function trace(region) {
  // The blue channel separates the fill (~245) from the glow (<= 120). It is enlarged with a
  // Lanczos filter before thresholding, so the edge lands at sub-pixel accuracy and the traced
  // curves come out smooth and the stems come out straight, not stair-stepped.
  const width = region.width * SUPERSAMPLE
  const height = region.height * SUPERSAMPLE
  const data = await sharp(source)
    .extract(region)
    .extractChannel(2)
    .resize(width, height, { kernel: 'lanczos3' })
    .blur(SMOOTHING) // irons out sub-pixel wobble on the straight stems
    .raw()
    .toBuffer()
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i++) {
    const ink = data[i] >= 170 ? 0 : 255
    rgba.set([ink, ink, ink, 255], i * 4)
  }
  const svg = ImageTracer.imagedataToSVG(
    { width, height, data: rgba },
    {
      pal: [
        { r: 0, g: 0, b: 0, a: 255 },
        { r: 255, g: 255, b: 255, a: 255 },
      ],
      colorsampling: 0,
      numberofcolors: 2,
      ltres: 0.35,
      qtres: 0.35,
      pathomit: 400,
      roundcoords: 1,
      strokewidth: 0,
      blurradius: 0,
    },
  )
  // Keep only the ink layer; the white layer is the background.
  const d = [...svg.matchAll(/<path[^>]*fill="rgb\(0,0,0\)"[^>]*\sd="([^"]+)"/g)].map((m) => m[1]).join(' ')
  if (!d) throw new Error('The tracer found no letters; check the regions and the threshold.')
  // Back to the original artwork's units so every consumer shares one coordinate system.
  const scaled = d.replace(/-?\d+(\.\d+)?/g, (n) => String(Number((Number(n) / SUPERSAMPLE).toFixed(2))))
  return { d: scaled, width: region.width, height: region.height }
}

/** Apple-style continuous-corner rounded square (superellipse, n = 5), as an SVG path. */
function squircle(size, inset = 0, n = 5) {
  const a = size / 2 - inset
  const c = size / 2
  const points = []
  for (let i = 0; i < 360; i++) {
    const t = (i / 360) * Math.PI * 2
    const cos = Math.cos(t)
    const sin = Math.sin(t)
    const x = c + a * Math.sign(cos) * Math.abs(cos) ** (2 / n)
    const y = c + a * Math.sign(sin) * Math.abs(sin) ** (2 / n)
    points.push(`${x.toFixed(2)} ${y.toFixed(2)}`)
  }
  return `M${points.join(' L')} Z`
}

function iconSvg({ mark, markWidthRatio, inset, fullBleed }) {
  const size = 1024
  const scale = (size * markWidthRatio) / mark.width
  const w = mark.width * scale
  const h = mark.height * scale
  const tx = (size - w) / 2
  const ty = (size - h) / 2
  const shape = fullBleed ? `M0 0H${size}V${size}H0Z` : squircle(size, inset)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="46%" r="70%">
      <stop offset="0" stop-color="${NAVY_LIFT}"/><stop offset="1" stop-color="${NAVY}"/>
    </radialGradient>
    <filter id="glow" x="-20%" y="-30%" width="140%" height="160%">
      <feGaussianBlur stdDeviation="${(size * 0.012).toFixed(1)}"/>
    </filter>
    <clipPath id="shape"><path d="${shape}"/></clipPath>
  </defs>
  <g clip-path="url(#shape)">
    <rect width="${size}" height="${size}" fill="url(#bg)"/>
    <g transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${scale.toFixed(4)})">
      <path d="${mark.d}" fill="${BLUE}" fill-rule="evenodd" filter="url(#glow)" opacity=".85"/>
      <path d="${mark.d}" fill="${BLUE}" fill-rule="evenodd"/>
    </g>
  </g>
  ${fullBleed ? '' : `<path d="${squircle(size, size * 0.012)}" fill="none" stroke="${BLUE}" stroke-opacity=".6" stroke-width="${(size * 0.022).toFixed(1)}"/>`}
</svg>
`
}

const [word, letterP] = await Promise.all([trace(WORD), trace(LETTER_P)])
await mkdir(publicDir, { recursive: true })
await mkdir(path.join(root, 'src/brand'), { recursive: true })

await writeFile(
  path.join(root, 'src/brand/wordmark.generated.ts'),
  `// Generated by scripts/make-brand.mjs from brand/source/logo-original.png. Do not edit.\n` +
    `export const wordmark = { width: ${word.width}, height: ${word.height}, d: ${JSON.stringify(word.d)} } as const\n` +
    `export const letterP = { width: ${letterP.width}, height: ${letterP.height}, d: ${JSON.stringify(letterP.d)} } as const\n`,
)
await writeFile(
  path.join(publicDir, 'logo.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${word.width} ${word.height}"><title>pixels</title><path d="${word.d}" fill="${BLUE}" fill-rule="evenodd"/></svg>\n`,
)

// Large sizes carry the whole wordmark; tiny sizes use the "p" so they stay legible.
const wordIcon = iconSvg({ mark: word, markWidthRatio: 0.95, inset: 0, fullBleed: false })
// The app icon (taskbar, dock, installer) shows the whole word, as large as the tile allows: no margin, so it matches other apps' icons.
const macIcon = iconSvg({ mark: word, markWidthRatio: 0.95, inset: 0, fullBleed: false })
const fullBleedWord = iconSvg({ mark: word, markWidthRatio: 0.66, inset: 0, fullBleed: true })
const smallIcon = iconSvg({ mark: letterP, markWidthRatio: 0.58, inset: 0, fullBleed: false })
await writeFile(path.join(publicDir, 'icon.svg'), wordIcon)
await writeFile(path.join(publicDir, 'icon-small.svg'), smallIcon)

const png = (svg, size, name) =>
  sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(path.join(publicDir, name))
await Promise.all([
  png(smallIcon, 16, 'favicon-16.png'),
  png(smallIcon, 32, 'favicon-32.png'),
  png(smallIcon, 48, 'favicon-48.png'),
  png(fullBleedWord, 180, 'apple-touch-icon.png'), // iOS applies its own squircle mask
  png(wordIcon, 512, 'icon-512.png'),
  png(macIcon, 1024, 'icon-1024.png'), // source for `tauri icon` (.ico/.icns/.png set)
])
console.log('brand assets written to public/ and src/brand/')

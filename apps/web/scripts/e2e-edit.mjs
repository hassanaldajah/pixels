/**
 * Phase 2 browser test: the GPU preview must match the server's NumPy export.
 * For each edit state it renders in the browser (WebGL), exports the same state from the server,
 * and compares the two images pixel by pixel.
 *
 *   PIXELS_BASE=http://127.0.0.1:8765 pnpm e2e:edit
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright-core'
import sharp from 'sharp'

const base = process.env.PIXELS_BASE ?? 'http://127.0.0.1:8765'
const shots = path.resolve(process.env.PIXELS_SHOTS ?? 'e2e-shots')
await mkdir(shots, { recursive: true })

const fail = []
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) fail.push(label)
}

// A deterministic photo-like test picture: gradients, colour patches, edges and a little texture.
const W = 256
const H = 192
const raw = Buffer.alloc(W * H * 4)
let seed = 12345
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    const patch = Math.floor(x / 64) + 4 * Math.floor(y / 64)
    const hue = (patch * 47) % 360
    const c = (h) => 0.5 + 0.5 * Math.cos(((h - 0) * Math.PI) / 180)
    let r = 0.25 + 0.5 * (x / W) + 0.2 * c(hue)
    let g = 0.2 + 0.6 * (y / H) + 0.2 * c(hue + 120)
    let b = 0.3 + 0.4 * Math.sin(x / 17) * Math.cos(y / 13) + 0.2 * c(hue + 240)
    if (x > 90 && x < 170 && y > 60 && y < 130) [r, g, b] = [0.9, 0.85, 0.2] // a hard-edged patch
    const n = (rnd() - 0.5) * 0.04
    raw[i] = Math.round(Math.min(1, Math.max(0, r + n)) * 255)
    raw[i + 1] = Math.round(Math.min(1, Math.max(0, g + n)) * 255)
    raw[i + 2] = Math.round(Math.min(1, Math.max(0, b + n)) * 255)
    raw[i + 3] = 255
  }
const png = await sharp(raw, { raw: { width: W, height: H, channels: 4 } })
  .png()
  .toBuffer()

const adjust = (over = {}) => ({
  exposure: 0,
  temperature: 0,
  tint: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  vibrance: 0,
  saturation: 0,
  levels: { black: 0, white: 1, gamma: 1 },
  hsl: { hue: Array(8).fill(0), sat: Array(8).fill(0), lum: Array(8).fill(0) },
  curves: {
    master: [
      [0, 0],
      [1, 1],
    ],
    r: [
      [0, 0],
      [1, 1],
    ],
    g: [
      [0, 0],
      [1, 1],
    ],
    b: [
      [0, 0],
      [1, 1],
    ],
  },
  noise_reduction: 0,
  sharpen: { amount: 0, radius: 1, threshold: 0 },
  vignette: { amount: 0, midpoint: 50, feather: 50 },
  grain: { amount: 0, size: 1, seed: 1 },
  ...over,
})

// [name, state, tolerance { mean, max }, border pixels to ignore]
const exact = { mean: 0.3, max: 2 }
const point = { mean: 0.6, max: 3 }
const spatial = { mean: 1.2, max: 10 }
const resampled = { mean: 1.5, max: 12 }
const cases = [
  ['identity-with-geometry', { geometry: [{ type: 'flip', axis: 'h' }], adjust: adjust() }, exact, 0],
  [
    'rotate90 + crop + flip (exact copies)',
    {
      geometry: [
        { type: 'rotate90', turns: 1 },
        { type: 'crop', x: 10, y: 20, w: 120, h: 150 },
        { type: 'flip', axis: 'v' },
      ],
      adjust: adjust(),
    },
    exact,
    0,
  ],
  [
    'exposure + contrast + saturation',
    { geometry: [], adjust: adjust({ exposure: 0.7, contrast: 20, saturation: -15 }) },
    point,
    0,
  ],
  [
    'temperature, tint, vibrance',
    { geometry: [], adjust: adjust({ temperature: 35, tint: -20, vibrance: 40 }) },
    point,
    0,
  ],
  [
    'highlights, shadows, whites, blacks',
    { geometry: [], adjust: adjust({ highlights: -60, shadows: 55, whites: 20, blacks: -25 }) },
    point,
    0,
  ],
  [
    'HSL bands',
    {
      geometry: [],
      adjust: adjust({
        hsl: {
          hue: [30, -20, 0, 40, 0, -50, 0, 25],
          sat: [40, 0, -30, 20, 0, 50, -40, 0],
          lum: [10, 0, 20, -20, 0, 15, 0, -10],
        },
      }),
    },
    point,
    0,
  ],
  [
    'levels',
    { geometry: [], adjust: adjust({ levels: { black: 0.08, white: 0.92, gamma: 1.4 } }) },
    point,
    0,
  ],
  [
    'curves (master + red)',
    {
      geometry: [],
      adjust: adjust({
        curves: {
          master: [
            [0, 0],
            [0.25, 0.15],
            [0.75, 0.9],
            [1, 1],
          ],
          r: [
            [0, 0],
            [0.5, 0.62],
            [1, 1],
          ],
          g: [
            [0, 0],
            [1, 1],
          ],
          b: [
            [0, 0.05],
            [1, 1],
          ],
        },
      }),
    },
    point,
    0,
  ],
  [
    'sharpen + threshold',
    { geometry: [], adjust: adjust({ sharpen: { amount: 120, radius: 1.5, threshold: 4 } }) },
    spatial,
    0,
  ],
  ['noise reduction', { geometry: [], adjust: adjust({ noise_reduction: 70 }) }, spatial, 0],
  [
    'vignette',
    { geometry: [], adjust: adjust({ vignette: { amount: -60, midpoint: 40, feather: 55 } }) },
    point,
    0,
  ],
  [
    'everything together',
    {
      geometry: [],
      adjust: adjust({
        exposure: -0.3,
        contrast: 12,
        saturation: 10,
        shadows: 25,
        noise_reduction: 30,
        sharpen: { amount: 80, radius: 1, threshold: 0 },
        vignette: { amount: -30, midpoint: 50, feather: 50 },
        levels: { black: 0.02, white: 0.98, gamma: 1.1 },
      }),
    },
    spatial,
    0,
  ],
  [
    'rotate 12 degrees, expanded canvas',
    { geometry: [{ type: 'rotate', angle: 12, expand: true }], adjust: adjust() },
    resampled,
    2,
  ],
  ['straighten -6', { geometry: [{ type: 'straighten', angle: -6 }], adjust: adjust() }, resampled, 2],
  [
    'skew + perspective',
    {
      geometry: [
        { type: 'skew', x: 6, y: -3 },
        {
          type: 'perspective',
          quad: [
            [12, 6],
            [250, 0],
            [256, 188],
            [0, 192],
          ],
        },
      ],
      adjust: adjust(),
    },
    resampled,
    2,
  ],
  [
    'canvas with colour fill',
    { geometry: [{ type: 'canvas', w: 300, h: 260, anchor: 'br', fill: '#336699' }], adjust: adjust() },
    exact,
    0,
  ],
  [
    'geometry + adjustments',
    {
      geometry: [
        { type: 'rotate90', turns: 3 },
        { type: 'crop', x: 4, y: 8, w: 150, h: 200 },
      ],
      adjust: adjust({ exposure: 0.4, saturation: 20, sharpen: { amount: 60, radius: 1, threshold: 0 } }),
    },
    spatial,
    0,
  ],
]

const browser = await chromium.launch({
  channel: process.env.PIXELS_BROWSER ?? 'msedge',
  headless: true,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
})
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
await context.addInitScript(() => {
  sessionStorage.setItem('pixels.splash', '1')
  localStorage.setItem('pixels.e2e', '1')
})
const page = await context.newPage()
const problems = []
page.on(
  'console',
  (m) =>
    ['error', 'warning'].includes(m.type()) &&
    !m.text().includes('GPU stall due to ReadPixels') && // a driver hint about the test's read-back, not a fault
    problems.push(`${m.type()}: ${m.text()}`),
)
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))

await page.goto(base)
await page.setInputFiles('#pixels-file-input', { name: 'parity.png', mimeType: 'image/png', buffer: png })
await page.waitForSelector('.rightpanel .verdict', { timeout: 30000 })
await page.waitForFunction(() => window.__pixelsE2E?.engineReady === true, null, { timeout: 15000 })
const imageId = await page.evaluate(() => {
  const jobs = document.querySelector('.dock') // the id lives in the job list; read it from the image URL instead
  void jobs
  return performance
    .getEntriesByType('resource')
    .map((r) => r.name)
    .find((n) => /\/api\/images\/[0-9a-f]{32}$/.test(n))
    ?.split('/')
    .pop()
})
check(Boolean(imageId), `uploaded the test image (${imageId?.slice(0, 8)}…)`)

// Layers: a second picture (with soft transparency) goes through the Security Gate like any upload; the cases then
// place and blend it on the GPU and on the server.
const LW = 90
const LH = 70
const lraw = Buffer.alloc(LW * LH * 4)
for (let y = 0; y < LH; y++)
  for (let x = 0; x < LW; x++) {
    const i = (y * LW + x) * 4
    lraw[i] = Math.round(255 * (x / LW))
    lraw[i + 1] = Math.round(255 * (1 - y / LH))
    lraw[i + 2] = Math.round(255 * (0.5 + 0.5 * Math.sin((x + y) / 9)))
    lraw[i + 3] = x < 12 ? Math.round((x / 12) * 255) : 255 // a soft left edge
  }
const layerPng = await sharp(lraw, { raw: { width: LW, height: LH, channels: 4 } })
  .png()
  .toBuffer()
const layerId = await page.evaluate(async (bytes) => {
  const r = await fetch('/api/images', {
    method: 'POST',
    body: new Uint8Array(bytes),
    headers: { 'X-Filename': 'layer.png' },
  })
  return (await r.json()).id
}, Array.from(layerPng))
check(/^[0-9a-f]{32}$/.test(layerId ?? ''), 'uploaded the layer picture through the Security Gate')
const lay = (over) => ({
  id: 'layer1',
  image_id: layerId,
  name: 'L',
  visible: true,
  opacity: 100,
  blend: 'normal',
  x: 0,
  y: 0,
  scale: 1,
  ...over,
})
const layered = { mean: 1.0, max: 4 }
const layeredScaled = { mean: 1.5, max: 14 }
cases.push(
  [
    'layer: normal, whole-pixel move',
    { geometry: [], adjust: adjust(), layers: [lay({ x: 40, y: 30 })] },
    layered,
    0,
  ],
  [
    'layer: multiply at 60%',
    { geometry: [], adjust: adjust(), layers: [lay({ x: 100, y: 60, blend: 'multiply', opacity: 60 })] },
    layered,
    0,
  ],
  [
    'layer: screen + overlay stack',
    {
      geometry: [],
      adjust: adjust(),
      layers: [
        lay({ x: 10, y: 10, blend: 'screen' }),
        lay({ id: 'layer2', x: 60, y: 40, blend: 'overlay', opacity: 80 }),
      ],
    },
    layered,
    0,
  ],
  [
    'layer: darken, lighten, hidden',
    {
      geometry: [],
      adjust: adjust(),
      layers: [
        lay({ x: 20, y: 80, blend: 'darken' }),
        lay({ id: 'layer2', x: 90, y: 20, blend: 'lighten' }),
        lay({ id: 'layer3', visible: false, blend: 'difference' }),
      ],
    },
    layered,
    0,
  ],
  [
    'layer: difference + soft-light',
    {
      geometry: [],
      adjust: adjust(),
      layers: [
        lay({ x: 30, y: 50, blend: 'difference' }),
        lay({ id: 'layer2', x: 120, y: 90, blend: 'soft-light' }),
      ],
    },
    layered,
    0,
  ],
  [
    'layer: scaled 1.7 at a fractional position',
    { geometry: [], adjust: adjust(), layers: [lay({ x: 33.4, y: 21.7, scale: 1.7, opacity: 90 })] },
    layeredScaled,
    2,
  ],
  [
    'layer: shrunk to 0.45',
    { geometry: [], adjust: adjust(), layers: [lay({ x: 120, y: 70, scale: 0.45, blend: 'multiply' })] },
    layeredScaled,
    2,
  ],
  [
    'selection: rectangle with feather',
    {
      geometry: [],
      adjust: adjust({ exposure: 0.8, saturation: -40 }),
      selection: { kind: 'rect', x: 40, y: 30, w: 120, h: 90, points: [], feather: 12, invert: false },
    },
    layered,
    2,
  ],
  [
    'selection: ellipse, inverted',
    {
      geometry: [],
      adjust: adjust({ temperature: 40, contrast: 25 }),
      selection: { kind: 'ellipse', x: 60, y: 40, w: 140, h: 100, points: [], feather: 8, invert: true },
    },
    layered,
    2,
  ],
  [
    'selection: polygon (lasso) with feather',
    {
      geometry: [],
      adjust: adjust({ exposure: -0.6, vibrance: 50 }),
      selection: {
        kind: 'polygon',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        points: [
          [30, 20],
          [220, 40],
          [180, 160],
          [90, 120],
          [40, 170],
        ],
        feather: 10,
        invert: false,
      },
    },
    layered,
    2,
  ],
  [
    'local: graduated filter on top of global edits',
    {
      geometry: [],
      adjust: adjust({ contrast: 10 }),
      local: [
        {
          id: 'grad001',
          name: 'Sky',
          visible: true,
          mask: { kind: 'linear', x0: 128, y0: 0, x1: 128, y1: 110, invert: true },
          adjust: adjust({ exposure: -0.9, saturation: 35 }),
        },
      ],
    },
    layered,
    2,
  ],
  [
    'local: radial filter + graduated filter',
    {
      geometry: [],
      adjust: adjust(),
      local: [
        {
          id: 'rad0001',
          name: 'Spot',
          visible: true,
          mask: { kind: 'radial', x0: 130, y0: 90, x1: 200, y1: 90, invert: false },
          adjust: adjust({ exposure: 0.7, temperature: 30 }),
        },
        {
          id: 'grad002',
          name: 'Fade',
          visible: true,
          mask: { kind: 'linear', x0: 0, y0: 100, x1: 0, y1: 192, invert: false },
          adjust: adjust({ saturation: -60, vignette: { amount: -20, midpoint: 50, feather: 50 } }),
        },
      ],
    },
    spatial,
    2,
  ],
  [
    'clone: two strokes with different sources',
    {
      geometry: [],
      adjust: adjust(),
      clone: [
        {
          dx: 80,
          dy: 10,
          r: 26,
          hardness: 0.5,
          flow: 0.9,
          pts: [
            [40, 90],
            [56, 94],
            [72, 98],
            [88, 102],
          ],
        },
        {
          dx: -60,
          dy: -20,
          r: 18,
          hardness: 0.9,
          flow: 1,
          pts: [
            [190, 120],
            [200, 124],
          ],
        },
      ],
    },
    spatial,
    2,
  ],
  [
    'clone: after a crop, with adjustments on top',
    {
      geometry: [{ type: 'crop', x: 16, y: 12, w: 210, h: 160 }],
      adjust: adjust({ exposure: 0.3, saturation: 15 }),
      clone: [
        {
          dx: 50,
          dy: 30,
          r: 30,
          hardness: 0.4,
          flow: 0.8,
          pts: [
            [50, 40],
            [66, 46],
            [82, 52],
          ],
        },
      ],
    },
    spatial,
    2,
  ],
  ['blur (global)', { geometry: [], adjust: adjust({ blur: 5, saturation: 10 }) }, spatial, 0],
  [
    'blur (large) through a radial filter',
    {
      geometry: [],
      adjust: adjust(),
      local: [
        {
          id: 'blur0001',
          name: 'Blur',
          visible: true,
          mask: { kind: 'radial', x0: 128, y0: 96, x1: 190, y1: 96, invert: true },
          adjust: adjust({ blur: 14 }),
        },
      ],
    },
    spatial,
    2,
  ],
  [
    'brush: dodge strokes with an erased hole',
    {
      geometry: [],
      adjust: adjust(),
      local: [
        {
          id: 'brush001',
          name: 'Dodge',
          visible: true,
          paint: {
            strokes: [
              {
                r: 34,
                hardness: 0.3,
                flow: 0.5,
                erase: false,
                pts: [
                  [60, 70],
                  [78, 74],
                  [96, 78],
                  [114, 80],
                  [132, 84],
                ],
              },
              {
                r: 22,
                hardness: 0.8,
                flow: 0.9,
                erase: false,
                pts: [
                  [170, 120],
                  [176, 126],
                ],
              },
              { r: 10, hardness: 0.5, flow: 1, erase: true, pts: [[96, 78]] },
            ],
          },
          adjust: adjust({ exposure: 0.8, contrast: 15 }),
        },
      ],
    },
    layered,
    2,
  ],
  [
    'brush: two painted areas after a crop',
    {
      geometry: [{ type: 'crop', x: 20, y: 10, w: 200, h: 160 }],
      adjust: adjust({ saturation: 10 }),
      local: [
        {
          id: 'teeth01',
          name: 'Teeth',
          visible: true,
          paint: {
            strokes: [
              {
                r: 18,
                hardness: 0.6,
                flow: 0.7,
                erase: false,
                pts: [
                  [60, 50],
                  [70, 52],
                  [80, 54],
                ],
              },
            ],
          },
          adjust: adjust({ saturation: -55, exposure: 0.3 }),
        },
        {
          id: 'burn001',
          name: 'Burn',
          visible: true,
          paint: {
            strokes: [
              {
                r: 40,
                hardness: 0.1,
                flow: 0.4,
                erase: false,
                pts: [
                  [150, 110],
                  [165, 120],
                ],
              },
            ],
          },
          adjust: adjust({ exposure: -0.7 }),
        },
      ],
    },
    layered,
    2,
  ],
  [
    'layer: linear fade',
    {
      geometry: [],
      adjust: adjust(),
      layers: [
        lay({
          x: 20,
          y: 20,
          scale: 2,
          mask: { kind: 'linear', x0: 30, y0: 60, x1: 190, y1: 60, invert: false },
        }),
      ],
    },
    layeredScaled,
    2,
  ],
  [
    'layer: radial fade, inverted, multiply',
    {
      geometry: [],
      adjust: adjust(),
      layers: [
        lay({
          x: 40,
          y: 30,
          scale: 1.8,
          blend: 'multiply',
          mask: { kind: 'radial', x0: 110, y0: 80, x1: 170, y1: 80, invert: true },
        }),
      ],
    },
    layeredScaled,
    2,
  ],
  [
    'layer: after crop + adjustments',
    {
      geometry: [{ type: 'crop', x: 8, y: 8, w: 200, h: 150 }],
      adjust: adjust({ exposure: 0.4, saturation: 20 }),
      layers: [lay({ x: 50, y: 40, blend: 'overlay' })],
    },
    layered,
    0,
  ],
)

async function serverRender(state) {
  const response = await page.evaluate(
    async ([id, body]) => {
      const r = await fetch(`/api/images/${id}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return { status: r.status, bytes: Array.from(new Uint8Array(await r.arrayBuffer())) }
    },
    [imageId, { state, options: { format: 'png', bit_depth: 8, profile: 'sRGB' } }],
  )
  if (response.status !== 200)
    throw new Error(`export failed (${response.status}): ${Buffer.from(response.bytes).toString()}`)
  const { data, info } = await sharp(Buffer.from(response.bytes))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height }
}

for (const [name, state, tolerance, border] of cases) {
  await page.evaluate((s) => window.__pixelsE2E.commit(s), state)
  await page.waitForFunction(() => window.__pixelsE2E.readOutput() !== null, null, { timeout: 20000 })
  await page.waitForTimeout(250)
  const gpu = await page.evaluate(() => {
    const out = window.__pixelsE2E.readOutput()
    return out && { w: out.w, h: out.h, data: Array.from(out.data) }
  })
  const server = await serverRender(state)
  if (!gpu) {
    check(false, `${name}: no GPU output`)
    continue
  }
  if (gpu.w !== server.w || gpu.h !== server.h) {
    check(false, `${name}: size differs (GPU ${gpu.w}x${gpu.h}, server ${server.w}x${server.h})`)
    continue
  }
  let sum = 0
  let count = 0
  let max = 0
  let worst = ''
  for (let y = border; y < gpu.h - border; y++)
    for (let x = border; x < gpu.w - border; x++) {
      const i = (y * gpu.w + x) * 4
      for (let c = 0; c < 4; c++) {
        // Colour under fully transparent pixels is meaningless; compare it only where there is alpha.
        if (c < 3 && server.data[i + 3] === 0 && gpu.data[i + 3] === 0) continue
        const d = Math.abs(gpu.data[i + c] - server.data[i + c])
        sum += d
        count++
        if (d > max) {
          max = d
          worst = `x=${x} y=${y} ch=${c} gpu=${gpu.data[i + c]} server=${server.data[i + c]}`
        }
      }
    }
  const mean = sum / count
  check(
    mean <= tolerance.mean && max <= tolerance.max,
    `${name}: mean error ${mean.toFixed(3)}/255, worst ${max} (limit ${tolerance.mean} / ${tolerance.max})${max > tolerance.max ? `  [${worst}]` : ''}`,
  )
}

// The preview shows edits and the compare modes work.
await page.evaluate((s) => window.__pixelsE2E.commit(s), {
  geometry: [],
  adjust: adjust({ exposure: 1.2, saturation: 30 }),
})
await page.waitForTimeout(400)
await page.screenshot({ path: path.join(shots, '20-edited.png') })
await page.getByRole('radio', { name: 'Split' }).click()
await page.waitForTimeout(400)
await page.screenshot({ path: path.join(shots, '21-split.png') })
await page.getByRole('radio', { name: 'Side' }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: path.join(shots, '22-side.png') })
await page.getByRole('radio', { name: 'Edit' }).click()

// Undo / redo and the history list.
const historyCount = await page.locator('.history li').count()
check(historyCount >= cases.length, `history lists every committed edit (${historyCount})`)
await page.keyboard.press('Control+z')
await page.waitForTimeout(200)
check(
  (await page.locator('.history li[data-active="true"] .history-index').innerText()) ===
    String(historyCount - 2),
  'Ctrl+Z steps back one entry',
)
await page.keyboard.press('Control+Shift+z')
await page.waitForTimeout(200)
check(
  (await page.locator('.history li[data-active="true"] .history-index').innerText()) ===
    String(historyCount - 1),
  'Ctrl+Shift+Z steps forward',
)

// Adjust panel: drag a slider, one history entry per drag.
await page.keyboard.press('a')
await page.waitForSelector('.tool-panel')
await page.screenshot({ path: path.join(shots, '23-adjust-panel.png') })
const before = await page.locator('.history li').count()
const slider = page.locator('.slider', { hasText: 'Contrast' }).locator('input[type="range"]')
const box = await slider.boundingBox()
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2)
await page.mouse.down()
await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(300)
check(
  (await page.locator('.history li').count()) === before + 1,
  'dragging a slider adds exactly one history entry',
)
check(
  Number(await page.locator('.slider', { hasText: 'Contrast' }).locator('.slider-number').inputValue()) > 20,
  'the slider value moved',
)

// Transform panel and crop overlay.
await page.keyboard.press('c')
await page.waitForSelector('.overlay-crop')
await page.screenshot({ path: path.join(shots, '24-crop.png') })
await page.getByRole('button', { name: '1:1', exact: true }).click()
await page.waitForTimeout(200)
const cropText = await page.locator('.overlay-text').textContent()
check(/^(\d+) × \1$/.test(cropText.trim()), `1:1 ratio gives a square crop (${cropText.trim()})`)
await page.getByRole('button', { name: 'Apply crop' }).click()
await page.waitForTimeout(400)
check(
  (await page.locator('.hud').innerText()).includes('192 × 192'),
  'applying the crop changes the picture size to 192 x 192',
)

// Export dialog downloads a real file.
await page.keyboard.press('Control+e')
await page.waitForSelector('.dialog')
await page.screenshot({ path: path.join(shots, '25-export.png') })
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page
    .getByRole('button', { name: /^Export$/ })
    .last()
    .click(),
])
const file = await download.path()
const meta = await sharp(file).metadata()
check(
  meta.width === 192 && meta.height === 192 && meta.format === 'png',
  `export downloaded ${download.suggestedFilename()} (${meta.width}x${meta.height} ${meta.format})`,
)
await page.keyboard.press('Escape')

// Presets panel: icon set zip.
await page.keyboard.press('r')
await page.waitForSelector('.tool-panel')
await page.screenshot({ path: path.join(shots, '26-presets.png') })
const [iconZip] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.getByRole('button', { name: /Download icon set/ }).click(),
])
check(
  iconZip.suggestedFilename().endsWith('-app-icons.zip'),
  `icon set downloaded (${iconZip.suggestedFilename()})`,
)

// Project save and re-open keeps the history.
const [projectDownload] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.keyboard.press('Control+s'),
])
const projectPath = await projectDownload.path()
check(
  projectDownload.suggestedFilename().endsWith('.pxe'),
  `project saved (${projectDownload.suggestedFilename()})`,
)
const entriesBefore = await page.locator('.history li').count()
await page.setInputFiles('#pixels-file-input', projectPath)
await page.waitForTimeout(2500)
check(
  (await page.locator('.history li').count()) === entriesBefore,
  `re-opening the project restores all ${entriesBefore} history entries`,
)

check(
  problems.length === 0,
  `no console errors or CSP violations${problems.length ? ': ' + problems.join(' | ').slice(0, 400) : ''}`,
)
await browser.close()
if (fail.length) {
  console.error(`\n${fail.length} check(s) failed`)
  process.exit(1)
}
console.log('\nAll checks passed')

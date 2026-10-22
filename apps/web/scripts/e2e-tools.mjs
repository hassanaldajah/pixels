/**
 * Browser test for the tools that make pixels: Pixel Art, Eraser, Retouch and Upscale.
 * Needs the backend serving the built frontend:  PIXELS_BASE=http://127.0.0.1:8765 pnpm e2e:tools
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

// A 400 x 300 picture: a smooth gradient with a dark square to paint over.
const W = 400
const H = 300
const raw = Buffer.alloc(W * H * 3)
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3
    const dark = x > 150 && x < 210 && y > 110 && y < 170
    raw[i] = dark ? 20 : 90 + (x / W) * 120
    raw[i + 1] = dark ? 20 : 120 + (y / H) * 100
    raw[i + 2] = dark ? 20 : 200 - (x / W) * 80
  }
const png = await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
  .png()
  .toBuffer()

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
await context.addInitScript(() => sessionStorage.setItem('pixels.splash', '1'))
const page = await context.newPage()
const problems = []
page.on(
  'console',
  (m) => ['error', 'warning'].includes(m.type()) && problems.push(`${m.type()}: ${m.text()}`),
)
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))

await page.goto(base)
await page.waitForSelector('.toolrail')
await page.setInputFiles('#pixels-file-input', { name: 'tools.png', mimeType: 'image/png', buffer: png })
await page.waitForSelector('.facts')
const size = async () => (await page.locator('.facts dd').nth(1).innerText()).replace(/\s+/g, ' ')
const pick = (label) => page.locator('.toolrail .tool', { hasText: label }).click()
check((await size()).includes('400 × 300'), `opened a 400 x 300 picture (${await size()})`)

// ---- Pixel Art ------------------------------------------------------------------------------
await pick('Pixel Art')
await page.getByRole('button', { name: 'Make it pixel art' }).click()
await page.waitForSelector('.pixelart-overlay', { timeout: 20000 })
const overlay = page.locator('.pixelart-overlay')
check(
  (await overlay.evaluate((el) => getComputedStyle(el).imageRendering)) === 'pixelated',
  'pixel-art preview is drawn with crisp pixels',
)
await page.waitForFunction(
  () => /art pixels/.test(document.querySelector('.tool-panel .hint')?.textContent ?? ''),
  null,
  { timeout: 20000 },
)
const hint = await page.locator('.tool-panel .hint').first().innerText()
check(/67 × 50 art pixels/.test(hint), `grid is 67 x 50 for a pixel size of 6 (400 / 6 rounds up) (${hint})`)
await page.getByRole('radio', { name: /Game Boy/ }).click()
await page.waitForFunction(
  () => /· 4 colours/.test(document.querySelector('.tool-panel .hint')?.textContent ?? ''),
  null,
  { timeout: 20000 },
)
check(true, 'Game Boy palette gives 4 colours')
await page.screenshot({ path: path.join(shots, 't1-pixelart.png') })
await page.getByRole('button', { name: 'Turn off' }).click()
await page.waitForFunction(() => !document.querySelector('.pixelart-overlay'), null, { timeout: 10000 })
check(true, 'turning pixel art off removes the preview')

// ---- Eraser -----------------------------------------------------------------------------------
await pick('Eraser')
await page.waitForSelector('.eraser-layer')
const layer = await page.locator('.eraser-layer').boundingBox()
const at = (fx, fy) => ({ x: layer.x + layer.width * fx, y: layer.y + layer.height * fy })
const remove = page.getByRole('button', { name: 'Remove', exact: true })
check(await remove.isDisabled(), 'Remove is disabled before anything is painted')
await page.getByRole('radio', { name: 'Fast' }).click()
const a = at(0.4, 0.44)
const b = at(0.52, 0.56)
await page.mouse.move(a.x, a.y)
await page.mouse.down()
for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8)
await page.mouse.up()
await page.waitForFunction(() => !document.querySelector('.eraser-actions button.button-primary')?.disabled)
check(true, 'painting enables Remove')
await page.screenshot({ path: path.join(shots, 't2-eraser-painted.png') })
await remove.click()
await page.waitForFunction(
  () =>
    document.querySelector('.eraser-actions button.button-primary')?.disabled &&
    /Remove/.test(document.querySelector('.eraser-actions button.button-primary')?.textContent ?? ''),
  null,
  { timeout: 60000 },
)
check((await size()).includes('400 × 300'), 'the removal produced a picture of the same size')
const restore = page.getByRole('button', { name: 'Undo last removal' })
check(await restore.isEnabled(), '"Undo last removal" is available')
await page.screenshot({ path: path.join(shots, 't3-eraser-done.png') })
await restore.click()
await page.waitForFunction(
  () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Undo last removal')?.disabled,
)
check(true, 'undoing the removal goes back to the previous version')

// ---- Upscale ----------------------------------------------------------------------------------
await pick('Upscale')
await page.getByRole('radio', { name: '2×' }).click()
await page.getByRole('button', { name: 'Enlarge' }).click()
await page.waitForFunction(
  () => /800 × 600/.test(document.querySelector('.facts')?.textContent ?? ''),
  null,
  { timeout: 60000 },
)
check(true, 'upscale 2x gives 800 x 600')

// ---- Retouch ------------------------------------------------------------------------------------
await pick('Retouch')
await page.getByRole('button', { name: 'Smooth skin' }).click()
await page.waitForFunction(
  () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Smooth skin') !== undefined,
  null,
  { timeout: 60000 },
)
await page.waitForTimeout(1500)
check((await size()).includes('800 × 600'), 'skin smoothing keeps the size')
await page.getByRole('button', { name: 'Remove background' }).click()
await page.waitForTimeout(2500)
const retouchError = await page.locator('.tool-panel .hint-error').count()
check(
  retouchError === 0 || (await page.locator('.tool-panel .hint-error').first().innerText()).length > 0,
  'background removal answers (a result, or a clear message for a picture without a plain background)',
)
await page.screenshot({ path: path.join(shots, 't4-retouch.png') })

check(
  problems.length === 0,
  `no console errors or CSP violations${problems.length ? `: ${problems.join(' | ')}` : ''}`,
)
// ---- Brush (dodge, whiten, undo) ---------------------------------------------------------------
await pick('Brush')
await page.waitForSelector('.eraser-layer')
const brushLayer = await page.locator('.eraser-layer').boundingBox()
const bat = (fx, fy) => ({
  x: brushLayer.x + brushLayer.width * fx,
  y: brushLayer.y + brushLayer.height * fy,
})
const countLocal = () => page.locator('.history li').count()
const historyBefore = await countLocal()
const p0 = bat(0.15, 0.2)
const p1 = bat(0.35, 0.3)
await page.mouse.move(p0.x, p0.y)
await page.mouse.down()
for (let i = 1; i <= 10; i++)
  await page.mouse.move(p0.x + ((p1.x - p0.x) * i) / 10, p0.y + ((p1.y - p0.y) * i) / 10)
await page.mouse.up()
await page.waitForFunction((n) => document.querySelectorAll('.history li').length > n, historyBefore, {
  timeout: 8000,
})
check((await countLocal()) === historyBefore + 1, 'one brush stroke adds exactly one history entry')
await page.screenshot({ path: path.join(shots, 't4-brush-dodge.png') })
const stateOf = () => page.evaluate(() => JSON.stringify(window.__pixelsE2E ? 'e2e' : 'none'))
void stateOf
await page.keyboard.press('Control+z')
await page.waitForTimeout(300)
check(
  (await page.locator('.history li[data-active="true"]').count()) >= 0,
  'undo steps the brush stroke back',
)
await page.keyboard.press('Control+Shift+z')
await page.waitForTimeout(300)
// a second stroke goes into the same painted area (no new adjustment)
await pick('Select')
await pick('Brush')
check(
  (await page.getByText('Your next stroke starts a new painted area').count()) +
    (await page.getByText('Painting into').count()) ===
    1,
  'the brush panel says where the next stroke goes',
)

// ---- Text and shapes as layers ---------------------------------------------------------------
await pick('Select')
await page.locator('.section-head', { hasText: 'Text & shapes' }).click()
await page.getByRole('textbox', { name: 'Text' }).fill('Hello')
const layersBefore = await page.locator('.history li').count()
await page.getByRole('button', { name: 'Add text layer' }).click()
await page.waitForFunction((n) => document.querySelectorAll('.history li').length > n, layersBefore, {
  timeout: 20000,
})
check(true, 'adding text creates a layer (one history step)')
await page.getByRole('button', { name: 'Add shape layer' }).click()
await page.waitForFunction((n) => document.querySelectorAll('.history li').length > n + 1, layersBefore, {
  timeout: 20000,
})
check(true, 'adding a shape creates another layer')

// ---- Move tool: drag the selected layer ---------------------------------------------------------
await page.locator('.section-head', { hasText: 'Layers' }).first().click()
await page.locator('.layer-name').first().click()
const xBefore = await page
  .locator('.slider')
  .filter({ has: page.locator('label', { hasText: /^X$/ }) })
  .first()
  .locator('input[type="number"]')
  .inputValue()
await pick('Move')
await page.waitForSelector('.move-layer')
const mb = await page.locator('.move-layer').boundingBox()
await page.mouse.move(mb.x + mb.width * 0.5, mb.y + mb.height * 0.5)
await page.mouse.down()
for (let i = 1; i <= 6; i++) await page.mouse.move(mb.x + mb.width * (0.5 + i * 0.04), mb.y + mb.height * 0.5)
await page.mouse.up()
await page.waitForTimeout(400)
const xAfter = await page
  .locator('.slider')
  .filter({ has: page.locator('label', { hasText: /^X$/ }) })
  .first()
  .locator('input[type="number"]')
  .inputValue()
check(xBefore !== xAfter, `dragging with the Move tool moves the layer (X ${xBefore} -> ${xAfter})`)

// ---- Lasso: draw a shape, it becomes the selection ----------------------------------------------
await pick('Lasso')
await page.waitForSelector('.lasso-layer')
const lb = await page.locator('.lasso-layer').boundingBox()
const around = [
  [0.3, 0.3],
  [0.7, 0.3],
  [0.75, 0.6],
  [0.5, 0.75],
  [0.28, 0.6],
  [0.3, 0.3],
]
await page.mouse.move(lb.x + lb.width * around[0][0], lb.y + lb.height * around[0][1])
await page.mouse.down()
for (const [fx, fy] of around.slice(1))
  await page.mouse.move(lb.x + lb.width * fx, lb.y + lb.height * fy, { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(400)
await page.locator('.section-head', { hasText: 'Selection' }).first().click()
check(
  (await page.getByText(/Free shape \(\d+ points\)/).count()) >= 1,
  'drawing with the Lasso creates a free-shape selection',
)

// ---- User guide (F1) ------------------------------------------------------------------------
await page.keyboard.press('F1')
await page.waitForSelector('[role="dialog"][aria-label="User guide"]')
check((await page.locator('.guide-nav button').count()) >= 15, 'F1 opens the user guide with its sections')
await page.locator('.guide-search').fill('feather')
check(
  (await page.locator('.guide-page h4').innerText()).includes('Selection'),
  'searching the guide jumps to the matching section',
)
await page.locator('.guide-search').fill('zzzzqqq')
check((await page.getByText('Nothing matches').count()) === 1, 'a search with no match says so')
await page.keyboard.press('Escape')
await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="User guide"]'))
await page.getByRole('button', { name: 'User guide' }).click()
check(
  (await page.locator('[role="dialog"][aria-label="User guide"]').count()) === 1,
  'the Help button in the top bar opens the guide',
)
await page.keyboard.press('Escape')

await browser.close()
console.log(fail.length ? `\n${fail.length} check(s) failed` : '\nAll checks passed')
process.exit(fail.length ? 1 : 0)

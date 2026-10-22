/**
 * End-to-end smoke test in a real browser (Edge/Chrome via playwright-core; nothing is downloaded).
 * Needs the backend serving the built frontend:  PIXELS_BASE=http://127.0.0.1:8765 pnpm e2e
 * Writes screenshots to PIXELS_SHOTS (default: ./e2e-shots).
 */
import { mkdir, writeFile } from 'node:fs/promises'
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

// Fixtures: a 3000x2000 image (6 tiles) with a transparent corner, and a disguised executable.
const W = 3000
const H = 2000
const raw = Buffer.alloc(W * H * 4)
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    raw[i] = (x / W) * 255
    raw[i + 1] = (y / H) * 255
    raw[i + 2] = 160 + 60 * Math.sin(x / 90) * Math.cos(y / 90)
    raw[i + 3] = x < 400 && y < 300 ? 0 : 255
  }
const bigPng = await sharp(raw, { raw: { width: W, height: H, channels: 4 } })
  .png({ compressionLevel: 3 })
  .toBuffer()
const exe = Buffer.concat([
  Buffer.from('MZ'),
  Buffer.alloc(60, 0x90),
  Buffer.from('This program cannot be run in DOS mode.'),
])

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
const page = await context.newPage()
const problems = []
page.on(
  'console',
  (m) => ['error', 'warning'].includes(m.type()) && problems.push(`${m.type()}: ${m.text()}`),
)
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))

const zoomText = () => page.locator('.hud span').first().innerText()

await page.goto(base)
await page.waitForSelector('.splash')
check((await page.locator('.splash').count()) === 1, 'splash is shown on first load')
const box = await page
  .locator('.splash')
  .boundingBox({ timeout: 2000 })
  .catch(() => null)
check(box !== null && box.width === 1600 && box.height === 900, 'splash covers the whole window')
await page.screenshot({ path: path.join(shots, '01-splash-start.png') })
await page.waitForTimeout(500)
await page.screenshot({ path: path.join(shots, '02-splash-mid.png') })
await page.waitForTimeout(500)
await page.screenshot({ path: path.join(shots, '03-splash-late.png') })
await page.waitForSelector('.splash', { state: 'detached', timeout: 8000 })
check(true, 'splash finishes by itself')
await page.waitForTimeout(900)
await page.screenshot({ path: path.join(shots, '04-workspace-empty.png') })

check(
  (await page.locator('.topbar').count()) === 1 && (await page.locator('.toolrail .tool').count()) === 12,
  'workspace shell and 12 tools render',
)
check((await page.locator('.tier').count()) === 0, 'no hardware-tier badge (no AI models are used)')

// A hostile file is refused with a readable reason and the gate steps.
await page.setInputFiles('#pixels-file-input', { name: 'photo.png', mimeType: 'image/png', buffer: exe })
await page.waitForSelector('.toast-danger')
await page.waitForTimeout(400)
await page.screenshot({ path: path.join(shots, '05-rejected.png') })
const reason = await page.locator('.toast-danger').innerText()
check(/Windows executable|does not look like/i.test(reason), `executable renamed to .png is refused`)
await page.locator('.toast-danger button[aria-label="Dismiss"]').click()

// A real image goes through the gate and appears.
await page.setInputFiles('#pixels-file-input', {
  name: 'gradient.png',
  mimeType: 'image/png',
  buffer: bigPng,
})
await page.waitForSelector('.rightpanel .verdict', { timeout: 30000 })
await page.waitForTimeout(1200)
await page.screenshot({ path: path.join(shots, '06-image-open.png') })
check(
  (await page.locator('.verdict').innerText()).includes('Passed Pixels security checks'),
  'valid image passes the security checks',
)
check(
  (await page
    .locator('.gate-steps li[data-status="passed"], .gate-steps li[data-status="partial"]')
    .count()) === 10,
  'all 10 gate steps are reported',
)
check((await page.locator('.facts').first().innerText()).includes('3,000'), 'properties show 3,000 x 2,000')
check((await page.locator('.hud').innerText()).includes('3000'), 'HUD shows the image size')

// WebGL really drew the picture: the viewport must contain the gradient, not just the background.
const view = await page.screenshot({ clip: { x: 300, y: 200, width: 800, height: 500 } })
const { channels } = await sharp(view).stats()
const spread = channels.slice(0, 3).map((c) => Math.round(c.stdev))
check(
  spread.some((s) => s > 25),
  `viewport shows the image (colour spread ${spread.join('/')})`,
)

// Zoom with the wheel keeps working and updates the HUD.
const before = await zoomText()
await page.mouse.move(700, 450)
for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -240)
await page.waitForTimeout(700)
const after = await zoomText()
await page.screenshot({ path: path.join(shots, '07-zoomed.png') })
check(before !== after, `wheel zoom changes the zoom (${before} -> ${after})`)

// Keyboard: Ctrl+1 = 100%, Ctrl+0 = fit.
await page.keyboard.press('Control+1')
await page.waitForTimeout(600)
check((await zoomText()) === '100%', 'Ctrl+1 gives 100%')
await page.keyboard.press('Control+0')
await page.waitForTimeout(600)
check((await zoomText()) !== '100%', 'Ctrl+0 fits the image')

// Add a guide from the ruler, then the thirds grid.
await page.mouse.move(300, 90)
await page.mouse.down()
await page.mouse.move(300, 400, { steps: 6 })
await page.mouse.up()
await page.keyboard.press('Control+Quote')
await page.waitForTimeout(400)
await page.screenshot({ path: path.join(shots, '08-guide-thirds.png') })

// Command palette and theme wipe.
await page.keyboard.press('Control+k')
await page.waitForSelector('.palette')
await page.screenshot({ path: path.join(shots, '09-palette.png') })
await page.keyboard.press('Escape')
await page.locator('button[aria-label^="Switch to"]').click()
await page.waitForTimeout(450)
await page.screenshot({ path: path.join(shots, '10-theme-wipe-mid.png') })
await page.waitForTimeout(900)
check(
  (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light',
  'theme switches to Light Studio',
)
await page.screenshot({ path: path.join(shots, '11-light.png') })

// Dock toggle.
await page.keyboard.press('Control+j')
await page.waitForTimeout(700)
await page.screenshot({ path: path.join(shots, '12-dock-open.png') })

check(
  problems.length === 0,
  `no console errors or CSP violations${problems.length ? ': ' + problems.join(' | ') : ''}`,
)
await writeFile(path.join(shots, 'problems.txt'), problems.join('\n'))
await browser.close()
if (fail.length) {
  console.error(`\n${fail.length} check(s) failed`)
  process.exit(1)
}
console.log('\nAll checks passed')

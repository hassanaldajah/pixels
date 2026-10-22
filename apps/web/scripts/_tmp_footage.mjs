// Real footage of the pixels app, captured from a headless browser (never from the user's screen).
// Client-side interactions (the eraser brush, sliders) are captured frame by frame; server work (pixel art,
// erase, upscale) is captured as before/after states.
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'

const root = 'C:/Users/plati/AppData/Local/Temp/claude/c--Users-plati-Desktop-HK-File/42e12d06-7576-4302-aab7-fb2043b3a6ed/scratchpad/video'
const A = `${root}/assets`
const F = `${root}/footage`
mkdirSync(F, { recursive: true })
const CLIP = { x: 0, y: 70, width: 1600, height: 868 } // the workspace: tool rail, canvas and inspector
const meta = { clip: CLIP, boxes: {}, seq: {} }

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
await context.addInitScript(() => sessionStorage.setItem('pixels.splash', '1'))
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

const rel = (b) => ({ x: b.x - CLIP.x, y: b.y - CLIP.y, w: b.width, h: b.height })
const box = async (name, locator) => {
  const b = await locator.first().boundingBox()
  if (b) meta.boxes[name] = rel(b)
}
const shot = (name, clip = CLIP) => page.screenshot({ path: `${F}/${name}.jpg`, type: 'jpeg', quality: 94, clip })
const tool = async (label) => {
  await page.locator('.toolrail .tool', { hasText: label }).click()
  await page.waitForTimeout(450)
}
const closeNotice = () =>
  page.locator('text=ClamAV').first().locator('xpath=ancestor::*[.//button][1]').locator('button').last().click({ timeout: 2500 }).catch(() => {})
const open = async (file) => {
  await page.setInputFiles('#pixels-file-input', file)
  await page.waitForSelector('.facts')
  await page.waitForTimeout(1500)
}

await page.goto('http://127.0.0.1:8765/')
await page.waitForSelector('.toolrail')
await open(`${A}/art_obj.png`)
await closeNotice()
await page.waitForTimeout(600)

// ---- 1. the workspace just after opening, and a tour of every tool ----------------------------------------
for (const label of ['Select', 'Transform', 'Adjust', 'Eraser', 'Retouch', 'Pixel Art', 'Upscale', 'Presets']) {
  await box(`tool_${label}`, page.locator('.toolrail .tool', { hasText: label }))
}
await shot('ws_open')
const tour = []
for (const label of ['Transform', 'Adjust', 'Eraser', 'Retouch', 'Pixel Art', 'Upscale', 'Presets']) {
  await tool(label)
  await shot(`tour_${label.replace(' ', '')}`)
  tour.push(label)
}
meta.seq.tour = tour.map((l) => `tour_${l.replace(' ', '')}`)

// ---- 2. security report (scroll the inspector to it) ----------------------------------------------------
await tool('Select')
await page.locator('.panel-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight))
await page.waitForTimeout(600)
await shot('ws_security')
await page.locator('.panel-scroll').evaluate((el) => (el.scrollTop = 0))

// ---- 3. adjust: drag exposure and saturation, frame by frame ---------------------------------------------
await tool('Adjust')
const adj = []
const setNum = async (label, v) => {
  await page.locator(`input[aria-label="${label} value"]`).fill(String(v))
  await page.waitForTimeout(260)
}
await box('adj_exposure', page.locator('input[aria-label="Exposure value"]').locator('xpath=ancestor::div[contains(@class,"slider")][1]'))
for (let i = 0; i <= 14; i++) {
  await setNum('Exposure', Math.round((i / 14) * 70) / 100)
  await shot(`adj_a${String(i).padStart(2, '0')}`)
  adj.push(`adj_a${String(i).padStart(2, '0')}`)
}
for (let i = 1; i <= 12; i++) {
  await setNum('Saturation', Math.round((i / 12) * 55))
  await shot(`adj_b${String(i).padStart(2, '0')}`)
  adj.push(`adj_b${String(i).padStart(2, '0')}`)
}
meta.seq.adjust = adj
await page.keyboard.press('Control+z')

// ---- 4. pixel art states -----------------------------------------------------------------------------------
await page.reload()
await page.waitForSelector('.toolrail')
await open(`${A}/art_obj.png`)
await closeNotice()
await tool('Pixel Art')
await box('btn_makepixel', page.getByRole('button', { name: 'Make it pixel art' }))
await page.getByRole('button', { name: 'Make it pixel art' }).click()
await page.waitForSelector('.pixelart-overlay', { timeout: 30000 })
await page.waitForTimeout(2500)
await box('slider_pixelsize', page.locator('input[aria-label="Pixel size value"]').locator('xpath=ancestor::div[contains(@class,"slider")][1]'))
await box('palette_gameboy', page.getByRole('radio', { name: /Game Boy/ }))
await box('palette_pico8', page.getByRole('radio', { name: /PICO-8/ }))
await box('palette_endesga', page.getByRole('radio', { name: /Endesga 32/ }))
const px = []
for (const size of [4, 6, 8, 10, 14, 20]) {
  await page.locator('input[aria-label="Pixel size value"]').fill(String(size))
  await page.waitForTimeout(2600)
  await shot(`px_size${String(size).padStart(2, '0')}`)
  px.push({ name: `px_size${String(size).padStart(2, '0')}`, size })
}
await page.locator('input[aria-label="Pixel size value"]').fill('10')
await page.waitForTimeout(2200)
for (const [id, re] of [['gameboy', /Game Boy/], ['pico8', /PICO-8/], ['endesga', /Endesga 32/]]) {
  await page.getByRole('radio', { name: re }).click()
  await page.waitForTimeout(2600)
  await shot(`px_${id}`)
}
await page.locator('.rightpanel .select-wrap select').selectOption('bayer4')
await page.waitForTimeout(2600)
await shot('px_dither')
meta.seq.pixel = px
await page.getByRole('button', { name: 'Turn off' }).click()
await page.waitForTimeout(900)

// ---- 5. eraser: the brush stroke is client-side, so every frame is captured live ----------------------
await tool('Eraser')
await page.waitForSelector('.eraser-layer')
await page.locator('input[aria-label="Size value"]').fill('130')
await page.getByRole('radio', { name: 'High quality' }).click()
await page.waitForTimeout(500)
const layer = await page.locator('.eraser-layer').boundingBox()
const at = (ix, iy) => ({ x: layer.x + (layer.width * ix) / 1200, y: layer.y + (layer.height * iy) / 900 })
const waypoints = [at(300, 210), at(352, 248), at(306, 292), at(344, 334), at(330, 400)]
const stroke = []
for (let i = 0; i < 6; i++) {
  // hover first: the brush ring moves in before any paint
  const p = { x: waypoints[0].x - 140 + i * 24, y: waypoints[0].y - 90 + i * 15 }
  await page.mouse.move(p.x, p.y)
  await shot(`er_h${i}`)
  stroke.push({ name: `er_h${i}`, x: p.x, y: p.y + 0 })
}
await page.mouse.move(waypoints[0].x, waypoints[0].y)
await page.mouse.down()
const steps = 40
for (let s = 1; s <= steps; s++) {
  const f = (s / steps) * (waypoints.length - 1)
  const i = Math.min(waypoints.length - 2, Math.floor(f))
  const k = f - i
  const x = waypoints[i].x + (waypoints[i + 1].x - waypoints[i].x) * k
  const y = waypoints[i].y + (waypoints[i + 1].y - waypoints[i].y) * k
  await page.mouse.move(x, y)
  await shot(`er_s${String(s).padStart(2, '0')}`)
  stroke.push({ name: `er_s${String(s).padStart(2, '0')}`, x, y })
}
await page.mouse.up()
await page.mouse.move(layer.x + layer.width * 0.78, layer.y + layer.height * 0.86)
await page.waitForTimeout(400)
await shot('er_ready')
await box('btn_remove', page.getByRole('button', { name: 'Remove', exact: true }))
meta.seq.eraser = stroke
await page.getByRole('button', { name: 'Remove', exact: true }).click()
await page.waitForFunction(
  () =>
    document.querySelector('.eraser-actions button.button-primary')?.disabled &&
    /Remove/.test(document.querySelector('.eraser-actions button.button-primary')?.textContent ?? ''),
  null,
  { timeout: 120000 },
)
await page.waitForTimeout(1400)
await shot('er_done')

// ---- 6. upscale -------------------------------------------------------------------------------------------
await tool('Upscale')
await box('btn_enlarge', page.getByRole('button', { name: 'Enlarge' }))
await shot('up_before')
await page.getByRole('radio', { name: '2×' }).click()
await page.getByRole('button', { name: 'Enlarge' }).click()
await page.waitForFunction(() => /2,?400 × 1,?800/.test(document.querySelector('.facts')?.textContent ?? ''), null, { timeout: 90000 })
await page.waitForTimeout(1600)
await shot('up_after')

// ---- 7. background removal on a product shot -------------------------------------------------------------
await open(`${A}/product.png`)
await tool('Retouch')
await box('btn_cutout', page.getByRole('button', { name: 'Remove background' }))
await shot('cut_before')
await page.getByRole('button', { name: 'Remove background' }).click()
await page.waitForTimeout(4500)
await shot('cut_after')

// ---- 8. export dialog --------------------------------------------------------------------------------------
await page.getByRole('button', { name: 'Export' }).first().click()
await page.waitForTimeout(1200)
await page.screenshot({ path: `${F}/full_export.jpg`, type: 'jpeg', quality: 94 })

writeFileSync(`${F}/footage.json`, JSON.stringify(meta, null, 1))
await browser.close()
console.log('footage done; page errors:', errors.length ? errors.join(' | ') : 'none')

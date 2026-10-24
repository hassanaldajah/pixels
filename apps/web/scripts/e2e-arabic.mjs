/**
 * Browser test for the Arabic interface: the language button, right-to-left layout, translated text, and back to English.
 * Needs the backend serving the built frontend:  PIXELS_BASE=http://127.0.0.1:8765 pnpm e2e:arabic
 */
import { chromium } from 'playwright-core'
import sharp from 'sharp'

const base = process.env.PIXELS_BASE ?? 'http://127.0.0.1:8765'
const fail = []
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) fail.push(label)
}

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
const context = await browser.newContext({ viewport: { width: 1500, height: 900 }, locale: 'en-US' })
await context.addInitScript(() => sessionStorage.setItem('pixels.splash', '1'))
const page = await context.newPage()
const problems = []
page.on('pageerror', (e) => problems.push(e.message))
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))

await page.goto(base)
await page.waitForSelector('.toolrail')
const dir = () => page.evaluate(() => `${document.documentElement.dir}/${document.documentElement.lang}`)
const railBox = async () => (await page.locator('.toolrail').boundingBox()) ?? { x: 0, width: 0 }
const panelBox = async () => (await page.locator('.rightpanel').boundingBox()) ?? { x: 0, width: 0 }

check((await dir()) === 'ltr/en', 'starts in English, left to right')
const englishRail = await railBox()
check(englishRail.x < 100, 'English: the tool rail is on the left')

await page.locator('.lang-toggle').click()
await page.waitForTimeout(300)
check((await dir()) === 'rtl/ar', 'the language button switches to Arabic, right to left')
const rail = await railBox()
const panel = await panelBox()
check(rail.x > 1000, 'Arabic: the tool rail moves to the right')
check(panel.x < 100, 'Arabic: the Inspector moves to the left')
check((await page.getByText('افتح صورة للبدء').count()) === 1, 'the empty state is in Arabic')
check((await page.locator('.tool-label', { hasText: 'ممحاة' }).count()) === 1, 'tool names are in Arabic')
check((await page.evaluate(() => localStorage.getItem('pixels.lang'))) === 'ar', 'the choice is remembered')

await page.reload()
await page.waitForSelector('.toolrail')
check((await dir()) === 'rtl/ar', 'Arabic is still on after a reload')

await page.keyboard.press('F1')
await page.waitForTimeout(400)
check((await page.getByText('دليل الاستخدام').count()) > 0, 'the user guide opens in Arabic')
check((await page.getByText('البدء').count()) > 0, 'the guide sections are in Arabic')
await page.keyboard.press('Escape')

await page.locator('.lang-toggle').click()
await page.waitForTimeout(300)
check((await dir()) === 'ltr/en', 'the button switches back to English')
check((await page.getByText('Open an image to start').count()) === 1, 'English text is back')
check((await railBox()).x < 100, 'English: the tool rail is back on the left')

// Arabic is often longer than English: on a small laptop screen, no text may spill out of or be cut by its box.
const small = await browser.newContext({ viewport: { width: 1280, height: 720 } })
await small.addInitScript(() => {
  sessionStorage.setItem('pixels.splash', '1')
  localStorage.setItem('pixels.lang', 'ar')
})
const tight = await small.newPage()
tight.on('pageerror', (e) => problems.push(e.message))
await tight.goto(base)
await tight.waitForSelector('.toolrail')
const tiny = await sharp({
  create: { width: 640, height: 480, channels: 3, background: { r: 90, g: 120, b: 160 } },
})
  .png()
  .toBuffer()
await tight.setInputFiles('#pixels-file-input', { name: 'tiny.png', mimeType: 'image/png', buffer: tiny })
await tight.waitForFunction(
  () => document.querySelector('.app')?.getAttribute('data-has-image') === 'true',
  null,
  {
    timeout: 60000,
  },
)
const overflowing = () =>
  tight.evaluate(() => {
    const found = []
    const selector =
      'button, label, .tool-label, h4, h5, .section-head span, .badge, .field > span, .slider label, .segmented button, .panel-head span, .check span'
    for (const el of document.querySelectorAll(selector)) {
      if (el.closest('.sr-only, .dock')) continue
      const box = el.getBoundingClientRect()
      const text = (el.innerText || '').trim()
      if (box.width === 0 || !/[؀-ۿ]/.test(text)) continue
      const range = document.createRange()
      range.selectNodeContents(el)
      const ink = range.getBoundingClientRect()
      const clipped = el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible'
      if (clipped || ink.left < box.left - 2 || ink.right > box.right + 2) found.push(text.slice(0, 40))
    }
    return found
  })
const spilled = new Set()
const toolCount = await tight.locator('.toolrail .tool').count()
for (let i = 0; i < toolCount; i++) {
  await tight.locator('.toolrail .tool').nth(i).click()
  for (
    let n = 0;
    n < 20 && (await tight.locator('.rightpanel .section-head[aria-expanded="false"]').count()) > 0;
    n++
  )
    await tight.locator('.rightpanel .section-head[aria-expanded="false"]').first().click()
  await tight.waitForTimeout(250)
  for (const text of await overflowing()) spilled.add(text)
}
check(
  spilled.size === 0,
  `no Arabic text spills out of its box at 1280x720${spilled.size ? `: ${[...spilled].join(' | ')}` : ''}`,
)
const railState = await tight
  .locator('.toolrail')
  .evaluate((el) => ({ more: el.dataset.more ?? '', fits: el.scrollHeight <= el.clientHeight + 1 }))
check(
  railState.fits || railState.more !== '',
  'every tool is reachable: the rail fits or shows that it scrolls',
)

check(problems.length === 0, `no console errors${problems.length ? `: ${problems.join(' | ')}` : ''}`)
await browser.close()
if (fail.length) {
  console.log(`\n${fail.length} check(s) failed`)
  process.exit(1)
}
console.log('\nAll checks passed')

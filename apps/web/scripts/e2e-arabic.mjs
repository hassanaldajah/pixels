/**
 * Browser test for the Arabic interface: the language button, right-to-left layout, translated text, and back to English.
 * Needs the backend serving the built frontend:  PIXELS_BASE=http://127.0.0.1:8765 pnpm e2e:arabic
 */
import { chromium } from 'playwright-core'

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

check(problems.length === 0, `no console errors${problems.length ? `: ${problems.join(' | ')}` : ''}`)
await browser.close()
if (fail.length) {
  console.log(`\n${fail.length} check(s) failed`)
  process.exit(1)
}
console.log('\nAll checks passed')

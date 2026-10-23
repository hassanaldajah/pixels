import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ar } from './ar'
import { NOT_WORDS, dataStrings, propStrings, tCalls } from './extract'
import { translate } from './index'

const root = join(__dirname, '..')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : ['.ts', '.tsx'].includes(extname(p)) ? [p] : []
  })
}

const DATA_FILES = [
  'lib/tools.ts',
  'lib/shortcuts.ts',
  'help/guide.ts',
  'state/ui.ts',
  'state/brush.ts',
  'state/transform.ts',
  'state/eraser.ts',
  'state/retouch.ts',
  'state/layers.ts',
  'state/image.ts',
  'state/edit.ts',
  'state/pixelPreview.ts',
  'api/client.ts',
  'api/edit.ts',
  'api/queries.ts',
  'lib/precheck.ts',
  'lib/imageLoader.ts',
]

describe('translate', () => {
  it('leaves English alone and fills in values', () => {
    expect(translate('en', 'Open')).toBe('Open')
    expect(translate('en', '{n} running', { n: 3 })).toBe('3 running')
  })

  it('translates a known text and fills in values', () => {
    expect(translate('ar', 'Open')).toBe('فتح')
    expect(translate('ar', '{n} running', { n: 3 })).toBe('3 قيد التنفيذ')
  })

  it('shows the English text when there is no translation, never a blank', () => {
    expect(translate('ar', 'A sentence nobody translated')).toBe('A sentence nobody translated')
  })

  it('translates server sentences that contain values', () => {
    expect(translate('ar', 'Detected PNG')).toBe('تم اكتشاف PNG')
    expect(translate('ar', 'The file is 12 MB; the limit is 8 MB.')).toContain('12')
    expect(translate('ar', 'Removed: EXIF, XMP')).toBe('أُزيل: EXIF, XMP')
  })

  it('translates a history label that ends with a number and keeps the number', () => {
    expect(translate('ar', 'Exposure +5')).toBe('التعريض +5')
  })
})

describe('the Arabic dictionary', () => {
  it('has no empty translation and keeps every {value} placeholder', () => {
    const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
    for (const [en, arabic] of Object.entries(ar)) {
      expect(arabic.trim(), en).not.toBe('')
      expect(holes(arabic), `placeholders in "${en}"`).toBe(holes(en))
    }
  })

  it('translates every text the app can show', () => {
    const missing = new Set<string>()
    for (const file of walk(root)) {
      const rel = file.slice(root.length + 1).replace(/\\/g, '/')
      if (rel.startsWith('i18n/') || /\.test\.tsx?$/.test(rel)) continue
      const source = readFileSync(file, 'utf8')
      const found = new Set<string>(tCalls(source))
      if (rel.startsWith('components/') || rel.startsWith('viewport/'))
        for (const k of propStrings(source)) found.add(k)
      if (DATA_FILES.includes(rel)) for (const k of dataStrings(source)) found.add(k)
      for (const k of found) if (!(k in ar) && !NOT_WORDS.test(k)) missing.add(k)
    }
    expect([...missing].sort()).toEqual([])
  })
})

// Lists the English texts the app can show that have no Arabic translation yet:   pnpm i18n
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { ar } from '../src/i18n/ar.ts'
import { NOT_WORDS, dataStrings, propStrings, tCalls } from '../src/i18n/extract.ts'

const root = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
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
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : ['.ts', '.tsx'].includes(extname(p)) ? [p] : []
  })

const keys = new Set()
for (const file of walk(root)) {
  const rel = file.slice(root.length).replace(/\\/g, '/')
  if (rel.startsWith('i18n/') || /\.test\.tsx?$/.test(rel)) continue
  const src = readFileSync(file, 'utf8')
  for (const k of tCalls(src)) keys.add(k)
  if (rel.startsWith('components/') || rel.startsWith('viewport/'))
    for (const k of propStrings(src)) keys.add(k)
  if (DATA_FILES.includes(rel)) for (const k of dataStrings(src)) keys.add(k)
}
const missing = [...keys].filter((k) => !(k in ar) && !NOT_WORDS.test(k))
console.log(missing.join('\n'))
console.error(`${keys.size} texts found, ${missing.length} without an Arabic translation`)

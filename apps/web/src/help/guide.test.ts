import { describe, expect, it } from 'vitest'
import { searchGuide } from '../components/GuideDialog'
import { COMMANDS } from '../lib/shortcuts'
import { TOOLS } from '../lib/tools'
import { GUIDE, guideToMarkdown } from './guide'

describe('the user guide', () => {
  it('has unique section ids and a summary and content for each', () => {
    expect(new Set(GUIDE.map((s) => s.id)).size).toBe(GUIDE.length)
    for (const s of GUIDE) {
      expect(s.title.length).toBeGreaterThan(3)
      expect(s.summary.length).toBeGreaterThan(3)
      expect(s.blocks.length).toBeGreaterThan(0)
    }
  })

  it('covers every tool in the rail', () => {
    const text = JSON.stringify(GUIDE).toLowerCase()
    for (const tool of TOOLS) expect(text).toContain(tool.label.toLowerCase())
  })

  it('lists the real shortcut keys for the tools', () => {
    const keysRow = GUIDE.flatMap((s) => s.blocks).find(
      (b) => 'keys' in b && b.keys.some(([k]) => k.startsWith('V')),
    )
    expect(keysRow).toBeTruthy()
    const letters = (keysRow as { keys: [string, string][] }).keys.find(([k]) => k.startsWith('V'))?.[0] ?? ''
    for (const tool of TOOLS) expect(letters).toContain(tool.shortcut)
  })

  it('mentions the commands that really exist', () => {
    const ids = new Set(COMMANDS.map((c) => c.id))
    for (const id of ['undo', 'redo', 'open', 'export', 'save-project', 'palette', 'guide', 'help'])
      expect(ids.has(id)).toBe(true)
  })

  it('can be searched by any word, and says nothing when nothing matches', () => {
    expect(searchGuide('blur').some((s) => s.id === 'adjust')).toBe(true)
    expect(searchGuide('feather').some((s) => s.id === 'selection')).toBe(true)
    expect(searchGuide('zzzzqqq')).toEqual([])
    expect(searchGuide('')).toEqual(GUIDE)
  })

  it('turns into Markdown with a contents list', () => {
    const md = guideToMarkdown()
    expect(md.startsWith('# pixels user guide')).toBe(true)
    for (const s of GUIDE) expect(md).toContain(`## ${s.title}`)
  })
})

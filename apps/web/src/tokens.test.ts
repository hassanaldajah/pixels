import { describe, expect, it } from 'vitest'
import { contrast } from './lib/color'
import { paletteVars, themes, tokensCss, type Palette } from './tokens'

const surfaces: (keyof Palette)[] = ['bg0', 'bg1', 'bg2', 'bg3']

describe.each(Object.entries(themes))('%s palette', (_name, p) => {
  it('keeps primary text at AAA contrast on every surface', () => {
    for (const s of surfaces) expect(contrast(p.text1, p[s])).toBeGreaterThanOrEqual(7)
  })

  it('keeps secondary and tertiary text readable on every surface', () => {
    for (const s of surfaces) {
      expect(contrast(p.text2, p[s])).toBeGreaterThanOrEqual(4.5)
      expect(contrast(p.text3, p[s])).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps the brand and status colours legible as text on the panel surface', () => {
    for (const k of ['accent', 'success', 'warning', 'danger'] as const)
      expect(contrast(p[k], p.bg1), k).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the soft accent visible as a UI component colour (WCAG 3:1)', () => {
    expect(contrast(p.accentSoft, p.bg1)).toBeGreaterThanOrEqual(3)
  })

  it('keeps the tool rail text readable on the blue rail', () => {
    for (const bg of [p.railTop, p.railBottom]) {
      expect(contrast(p.railText, bg)).toBeGreaterThanOrEqual(7)
      expect(contrast(p.railTextDim, bg)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('separates borders from the panel surface', () => {
    expect(contrast(p.line, p.bg1)).toBeGreaterThan(1.1)
    expect(contrast(p.lineStrong, p.bg1)).toBeGreaterThan(1.8)
  })
})

describe('tokens as CSS', () => {
  it('emits every palette key for both themes', () => {
    const css = tokensCss()
    for (const palette of Object.values(themes))
      for (const name of Object.keys(paletteVars(palette))) expect(css).toContain(name)
    expect(css).toContain(':root[data-theme="light"]')
  })

  it('defines both themes with exactly the same keys', () => {
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort())
  })
})

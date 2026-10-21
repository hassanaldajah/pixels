import { describe, expect, it } from 'vitest'
import { commandForKey } from './shortcuts'

const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}) =>
  commandForKey({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods })

describe('keyboard map', () => {
  it('maps the zoom shortcuts from the spec', () => {
    expect(key('=', { ctrlKey: true })).toBe('zoom-in')
    expect(key('+', { ctrlKey: true, shiftKey: true })).toBe('zoom-in')
    expect(key('-', { ctrlKey: true })).toBe('zoom-out')
    expect(key('0', { ctrlKey: true })).toBe('fit')
    expect(key('1', { ctrlKey: true })).toBe('actual')
  })

  it('opens the command palette with Ctrl+K and also accepts Cmd on macOS', () => {
    expect(key('k', { ctrlKey: true })).toBe('palette')
    expect(key('K', { metaKey: true })).toBe('palette')
  })

  it('uses single letters for tools and ignores them with modifiers', () => {
    expect(key('v')).toBe('tool-select')
    expect(key('e')).toBe('tool-eraser')
    expect(key('v', { altKey: true })).toBeNull()
  })

  it('does not claim unknown keys', () => {
    expect(key('q')).toBeNull()
    expect(key('Enter')).toBeNull()
  })
})

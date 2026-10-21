import { describe, expect, it } from 'vitest'
import { detectKind, precheck } from './precheck'

const bytes = (...n: number[]) => new Uint8Array(n)
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
const file = (data: number[], name: string) => new File([new Uint8Array(data)], name)

describe('detectKind', () => {
  it('recognises the allowed formats from their signatures', () => {
    expect(detectKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png')
    expect(detectKind(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg')
    expect(detectKind(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')))).toBe('webp')
    expect(detectKind(bytes(...ascii('II*'), 0))).toBe('tiff')
    expect(detectKind(bytes(...ascii('BM'), 0, 0))).toBe('bmp')
    expect(detectKind(bytes(0, 0, 0, 24, ...ascii('ftypavif')))).toBe('avif')
    expect(detectKind(bytes(0, 0, 0, 24, ...ascii('ftypheic')))).toBe('heif')
  })

  it('does not recognise executables, archives or scripts', () => {
    expect(detectKind(bytes(...ascii('MZ'), 0x90, 0))).toBe('unknown')
    expect(detectKind(bytes(...ascii('PK'), 3, 4))).toBe('unknown')
    expect(detectKind(new Uint8Array(ascii('<svg xmlns=')))).toBe('unknown')
  })
})

describe('precheck', () => {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]

  it('accepts a real PNG', async () => {
    expect(await precheck(file(png, 'a.png'))).toEqual({ ok: true, kind: 'png' })
  })

  it('rejects svg with an explanation', async () => {
    const r = await precheck(file(ascii('<svg/>'), 'logo.svg'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('scripts')
  })

  it('rejects empty, oversized and disguised files', async () => {
    expect((await precheck(file([], 'a.png'))).ok).toBe(false)
    expect((await precheck(file(png, 'a.png'), { maxBytes: 4 })).ok).toBe(false)
    expect((await precheck(file([...ascii('MZ'), 0, 0], 'photo.png'))).ok).toBe(false)
  })
})

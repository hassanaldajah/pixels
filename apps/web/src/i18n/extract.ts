/** Finds the English texts in the source code, so a test can check that each one has an Arabic translation. */

const unescape = (s: string, q: string): string =>
  s.replace(/\\(.)/g, (_, c: string) =>
    c === 'n' ? '\n' : c === q || c === '\\' || c === "'" || c === '"' || c === '`' ? c : '\\' + c,
  )

/** Every first argument of `t(...)`: a string literal, even when it runs over several lines. */
export function tCalls(source: string): Set<string> {
  const found = new Set<string>()
  const re = /\bt\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/gs
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    const text = m[2] as string
    if (!text.includes('${')) found.add(unescape(text, m[1] as string))
  }
  return found
}

/** Texts handed to the shared controls as props (label, title, hint, placeholder): the control translates them. */
export function propStrings(source: string): Set<string> {
  const found = new Set<string>()
  const re = /\b(?:label|title|hint|placeholder)\s*[=:]\s*\{?\s*(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    const text = unescape(m[2] as string, m[1] as string)
    if (!text.includes('${') && /[A-Za-z]/.test(text) && text.length > 1) found.add(text)
  }
  return found
}

/** Sentences in data files (tool descriptions, guide, presets...) that are translated where they are shown. */
export function dataStrings(source: string): Set<string> {
  const found = new Set<string>()
  const re = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    const text = unescape(m[2] as string, m[1] as string)
    if (text.includes('${') || text.length < 3) continue
    if (!/[A-Za-z]/.test(text) || (!/[A-Z]/.test(text[0] as string) && !/ /.test(text))) continue
    if (/^(https?:|\/api|[a-z]+-[a-z-]+$|\.\/|\.\.\/|#|--px)/.test(text)) continue
    if (/^[a-z_]+$/.test(text)) continue
    found.add(text)
  }
  return found
}

/** Things that look like text but are not words: key names, file signatures, header names, code. */
export const NOT_WORDS = new RegExp(
  [
    '^(X-|POST$|Content-Type$|RIFF$|WEBP$|II|MM|TEXTAREA$|SELECT$|PNG$|JPEG$|WebP$|AVIF$|TIFF$|sRGB$|Display P3$|pixels$)',
    '^(Ctrl\\+|V  M  L)',
    '^pnpm guide$',
    '^Generated from',
    '^\\| Keys',
    '^ ?SVG can',
    '^[a-z]+(?: [a-z]+-[a-z-]+)+$', // CSS class lists such as "hint hint-error"
    '^(?=.*-)[a-z-]+(?: [a-z-]+)+$', // and "panel-scroll v-pad"
    '^rgba?\\(', // colours
    '^(Esc|Escape|Backspace|Enter|Arrow(Left|Right|Up|Down))$', // key names stay as printed on the keyboard
    '^translate\\(', // CSS
    '^sudo ', // terminal commands are typed as they are
    '^(Video(De|En)coder|Ubuntu, Debian, Mint|Fedora|Arch, Manjaro)$', // API and system names
  ].join('|'),
)

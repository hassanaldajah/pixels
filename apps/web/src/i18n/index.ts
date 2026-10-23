import { useCallback } from 'react'
import { create } from 'zustand'
import { ar, arPatterns } from './ar'

/**
 * Languages. The English text itself is the key: `t('Open image')` returns the Arabic sentence when Arabic is on
 * and the same English text otherwise, so a missing translation shows English instead of a blank or a key name.
 * `{name}` marks a value to put in. Arabic is written right to left; the page direction follows the language.
 */
export type Lang = 'en' | 'ar'

const KEY = 'pixels.lang'

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'ar' || saved === 'en') return saved
  } catch {
    /* storage unavailable: use the browser language */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en'
}

function apply(lang: Lang): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lang
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
}

interface LangStore {
  lang: Lang
  setLang: (lang: Lang) => void
}

export const useLang = create<LangStore>((set) => ({
  lang: initial(),
  setLang: (lang) => {
    try {
      localStorage.setItem(KEY, lang)
    } catch {
      /* ignore */
    }
    apply(lang)
    set({ lang })
  },
}))
apply(useLang.getState().lang)

export type Vars = Record<string, string | number>

function fill(text: string, vars?: Vars): string {
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text
}

/** Translate `text` into `lang` (English stays as it is). */
export function translate(lang: Lang, text: string, vars?: Vars): string {
  if (lang === 'en') return fill(text, vars)
  const hit = ar[text]
  if (hit !== undefined) return fill(hit, vars)
  return fill(fromPattern(text) ?? text, vars)
}

/** Messages that come from the server carry numbers or names inside the sentence; these patterns translate them. */
function fromPattern(text: string): string | undefined {
  for (const [re, out] of arPatterns) {
    const m = re.exec(text)
    if (m) return out.replace(/\$(\d)/g, (_, i: string) => ar[m[Number(i)] ?? ''] ?? m[Number(i)] ?? '')
  }
  // a label that ends with a number, such as the history entry "Exposure +5": translate the words, keep the number
  const tail = /^(.*\S) ([+-]?\d[\d.,]*°?)$/.exec(text)
  if (tail && ar[tail[1] as string] !== undefined) return `${ar[tail[1] as string]} ${tail[2]}`
  return undefined
}

/** The current language, outside React (messages created in event handlers and stores). */
export const t = (text: string, vars?: Vars): string => translate(useLang.getState().lang, text, vars)

/** Inside a component: translates and re-renders when the language changes. */
export function useT(): (text: string, vars?: Vars) => string {
  const lang = useLang((s) => s.lang)
  return useCallback((text: string, vars?: Vars) => translate(lang, text, vars), [lang])
}

/** Digits in the Arabic interface stay western (1, 2, 3): they match the image sizes and the ruler. */
export const isRtl = (lang: Lang): boolean => lang === 'ar'

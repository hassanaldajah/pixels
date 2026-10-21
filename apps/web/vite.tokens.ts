import type { Plugin } from 'vite'
import { tokensCss } from './src/tokens.ts'

const ID = 'virtual:tokens.css'

/** Serves src/tokens.ts as a stylesheet of CSS variables, so tokens.ts stays the only source. */
export function tokensPlugin(): Plugin {
  return {
    name: 'pixels-tokens',
    resolveId: (id) => (id === ID ? `\0${ID}` : null),
    load: (id) => (id === `\0${ID}` ? tokensCss() : null),
  }
}

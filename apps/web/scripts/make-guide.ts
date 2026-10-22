// Writes docs/USER_GUIDE.md from the in-app guide (src/help/guide.ts), so the two never disagree.
import { writeFileSync } from 'node:fs'
import { guideToMarkdown } from '../src/help/guide'

writeFileSync(new URL('../../../docs/USER_GUIDE.md', import.meta.url), `${guideToMarkdown()}\n`)
console.log('docs/USER_GUIDE.md written')

import { useCallback } from 'react'
import { Splash } from './Splash'

/** The opening animation: the word grows out of the "p", then one soft band of light glides across it. */
export function SplashHost({ onDone, onReveal }: { onDone: () => void; onReveal?: () => void }) {
  const done = useCallback(() => onDone(), [onDone])
  return <Splash onDone={done} onReveal={onReveal} />
}

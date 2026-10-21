import { useState } from 'react'
import { useEraser } from '../state/eraser'
import { useImage } from '../state/image'
import { useRetouch } from '../state/retouch'
import { Check, Group, Slider } from './controls'

export function RetouchPanel() {
  const heal = useEraser()
  const retouch = useRetouch()
  const canRestore = useImage((s) => s.versions.length > 0)
  const restore = useImage((s) => s.restorePrevious)
  const [tolerance, setTolerance] = useState(30)
  const [feather, setFeather] = useState(1.5)
  const [contiguous, setContiguous] = useState(true)
  const [amount, setAmount] = useState(50)
  const [radius, setRadius] = useState(8)
  const [protect, setProtect] = useState(50)
  const busy = heal.busy || retouch.busy !== null

  return (
    <div className="tool-panel">
      <div className="tool-panel-head">
        <h4>Retouch</h4>
      </div>

      <Group title="Heal spots">
        <p className="hint">
          Paint over a spot, blemish or dust mark, then press Heal. It is filled from the surrounding pixels.
          Hold Alt to rub paint out.
        </p>
        <Slider
          label="Brush size"
          value={heal.brush}
          min={4}
          max={200}
          neutral={24}
          unit="px"
          onPreview={(v) => heal.set({ brush: v })}
          onCommit={(v) => heal.set({ brush: v })}
        />
        <div className="eraser-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={!heal.hasMask || busy}
            onClick={() => {
              heal.set({ quality: 'fast', grow: 3, feather: 2 })
              void heal.run()
            }}
          >
            {heal.busy ? 'Healing…' : 'Heal'}
          </button>
          <button
            type="button"
            className="button"
            disabled={heal.undoable === 0 || busy}
            onClick={heal.undoStroke}
          >
            Undo stroke
          </button>
          <button type="button" className="button" disabled={!heal.hasMask || busy} onClick={heal.clear}>
            Clear paint
          </button>
          <button type="button" className="button" disabled={!canRestore || busy} onClick={restore}>
            Undo last change
          </button>
        </div>
        {heal.error && (
          <p className="hint hint-error" role="alert">
            {heal.error}
          </p>
        )}
      </Group>

      <Group title="Skin smoothing">
        <p className="hint">Evens out skin tones and blemishes; eyes, hair and edges stay sharp.</p>
        <Slider
          label="Amount"
          value={amount}
          min={0}
          max={100}
          neutral={50}
          onPreview={setAmount}
          onCommit={setAmount}
        />
        <Slider
          label="Blemish size"
          value={radius}
          min={1}
          max={40}
          neutral={8}
          unit="px"
          onPreview={setRadius}
          onCommit={setRadius}
        />
        <Slider
          label="Keep edges"
          value={protect}
          min={0}
          max={100}
          neutral={50}
          onPreview={setProtect}
          onCommit={setProtect}
        />
        <button
          type="button"
          className="button"
          disabled={busy || amount === 0}
          onClick={() => void retouch.run('smooth', { amount, radius, protect })}
        >
          {retouch.busy === 'smooth' ? 'Smoothing…' : 'Smooth skin'}
        </button>
      </Group>

      <Group title="Remove background">
        <p className="hint">
          Makes a plain background transparent (studio shots, product photos, screenshots). It looks at the
          colour around the edge of the picture, so it works best on an even background.
        </p>
        <Slider
          label="Tolerance"
          value={tolerance}
          min={0}
          max={100}
          neutral={30}
          onPreview={setTolerance}
          onCommit={setTolerance}
        />
        <Slider
          label="Soften edge"
          value={feather}
          min={0}
          max={20}
          step={0.5}
          neutral={1.5}
          digits={1}
          unit="px"
          onPreview={setFeather}
          onCommit={setFeather}
        />
        <Check
          label="Only background connected to the edge"
          checked={contiguous}
          onChange={setContiguous}
          hint="Off: every pixel of that colour goes, even inside the subject"
        />
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void retouch.run('cutout', { tolerance, feather, contiguous, colour: null })}
        >
          {retouch.busy === 'cutout' ? 'Removing…' : 'Remove background'}
        </button>
      </Group>

      {retouch.error && (
        <p className="hint hint-error" role="alert">
          {retouch.error}
        </p>
      )}
      <p className="hint">
        Each action makes a new version; “Undo last change” goes back. Edits you made before (crop, colours)
        are applied to the picture first.
      </p>
    </div>
  )
}

import { useState } from 'react'
import { HSL_BANDS, defaultAdjust, isIdentityAdjust, type Adjust } from '../engine/types'
import { committedState, useDisplayedState, useEdit } from '../state/edit'
import { hslSwatches } from '../tokens'
import { CurvesEditor, type CurveChannel } from './CurvesEditor'
import { Group, Slider } from './controls'

type Path = string

/** Set a nested value (dot path) on a copy of the adjustments. */
function withValue(adjust: Adjust, path: Path, value: unknown): Adjust {
  const copy = structuredClone(adjust) as unknown as Record<string, unknown>
  const keys = path.split('.')
  let node = copy
  for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>
  node[keys[keys.length - 1] as string] = value
  return copy as unknown as Adjust
}

const preview = (path: Path, value: unknown) => {
  const state = committedState()
  useEdit.getState().preview({ ...state, adjust: withValue(state.adjust, path, value) })
}
const commit = (label: string, path: Path, value: unknown) => {
  const state = committedState()
  useEdit.getState().commit(label, { ...state, adjust: withValue(state.adjust, path, value) })
}

function Row(props: {
  label: string
  path: Path
  min: number
  max: number
  step?: number
  neutral?: number
  digits?: number
  unit?: string
  format?: string
}) {
  const adjust = useDisplayedState().adjust
  const value = props.path
    .split('.')
    .reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], adjust) as number
  return (
    <Slider
      label={props.label}
      value={value}
      min={props.min}
      max={props.max}
      step={props.step}
      neutral={props.neutral ?? 0}
      digits={props.digits}
      unit={props.unit}
      onPreview={(v) => preview(props.path, v)}
      onCommit={(v) =>
        commit(
          `${props.label} ${v > 0 && (props.neutral ?? 0) === 0 ? '+' : ''}${Number(v.toFixed(props.digits ?? 0))}`,
          props.path,
          v,
        )
      }
    />
  )
}

function Hsl() {
  const [band, setBand] = useState(0)
  const adjust = useDisplayedState().adjust
  const name = HSL_BANDS[band] as string
  return (
    <>
      <div className="swatches" role="tablist" aria-label="Colour band">
        {HSL_BANDS.map((b, i) => (
          <button
            key={b}
            type="button"
            role="tab"
            aria-selected={band === i}
            title={b}
            data-active={band === i}
            data-edited={adjust.hsl.hue[i] !== 0 || adjust.hsl.sat[i] !== 0 || adjust.hsl.lum[i] !== 0}
            style={{ background: hslSwatches[i] }}
            onClick={() => setBand(i)}
          />
        ))}
      </div>
      <Row label={`${name} hue`} path={`hsl.hue.${band}`} min={-100} max={100} />
      <Row label={`${name} saturation`} path={`hsl.sat.${band}`} min={-100} max={100} />
      <Row label={`${name} luminance`} path={`hsl.lum.${band}`} min={-100} max={100} />
    </>
  )
}

function Curves() {
  const [channel, setChannel] = useState<CurveChannel>('master')
  const points = useDisplayedState().adjust.curves[channel]
  return (
    <CurvesEditor
      channel={channel}
      points={points}
      onChannel={setChannel}
      onPreview={(p) => preview(`curves.${channel}`, p)}
      onCommit={(p) =>
        commit(`Curve (${channel === 'master' ? 'RGB' : channel.toUpperCase()})`, `curves.${channel}`, p)
      }
    />
  )
}

export function AdjustPanel() {
  const adjust = useDisplayedState().adjust
  const identity = isIdentityAdjust(adjust)
  return (
    <div className="tool-panel">
      <div className="tool-panel-head">
        <h4>Adjust</h4>
        <button
          type="button"
          className="link-button"
          disabled={identity}
          onClick={() =>
            useEdit.getState().commit('Reset adjustments', { ...committedState(), adjust: defaultAdjust() })
          }
        >
          Reset all
        </button>
      </div>
      <Group title="Light">
        <Row label="Exposure" path="exposure" min={-5} max={5} step={0.05} digits={2} unit="EV" />
        <Row label="Contrast" path="contrast" min={-100} max={100} />
        <Row label="Highlights" path="highlights" min={-100} max={100} />
        <Row label="Shadows" path="shadows" min={-100} max={100} />
        <Row label="Whites" path="whites" min={-100} max={100} />
        <Row label="Blacks" path="blacks" min={-100} max={100} />
      </Group>
      <Group title="Colour">
        <Row label="Temperature" path="temperature" min={-100} max={100} />
        <Row label="Tint" path="tint" min={-100} max={100} />
        <Row label="Vibrance" path="vibrance" min={-100} max={100} />
        <Row label="Saturation" path="saturation" min={-100} max={100} />
      </Group>
      <Group title="HSL">
        <Hsl />
      </Group>
      <Group title="Curves">
        <Curves />
      </Group>
      <Group title="Levels">
        <Row label="Black point" path="levels.black" min={0} max={0.98} step={0.005} neutral={0} digits={3} />
        <Row label="Gamma" path="levels.gamma" min={0.1} max={4} step={0.01} neutral={1} digits={2} />
        <Row label="White point" path="levels.white" min={0.02} max={1} step={0.005} neutral={1} digits={3} />
      </Group>
      <Group title="Detail">
        <Row label="Noise reduction" path="noise_reduction" min={0} max={100} />
        <Row label="Sharpen" path="sharpen.amount" min={0} max={300} />
        <Row
          label="Radius"
          path="sharpen.radius"
          min={0.3}
          max={5}
          step={0.1}
          neutral={1}
          digits={1}
          unit="px"
        />
        <Row label="Threshold" path="sharpen.threshold" min={0} max={50} />
      </Group>
      <Group title="Effects">
        <Row label="Vignette" path="vignette.amount" min={-100} max={100} />
        <Row label="Midpoint" path="vignette.midpoint" min={0} max={100} neutral={50} />
        <Row label="Feather" path="vignette.feather" min={1} max={100} neutral={50} />
        <Row label="Grain" path="grain.amount" min={0} max={100} />
        <Row
          label="Grain size"
          path="grain.size"
          min={0.5}
          max={8}
          step={0.1}
          neutral={1}
          digits={1}
          unit="px"
        />
      </Group>
      <p className="hint">
        Radii are in image pixels. On a downscaled preview they are scaled to match, so the export looks the
        same.
      </p>
    </div>
  )
}

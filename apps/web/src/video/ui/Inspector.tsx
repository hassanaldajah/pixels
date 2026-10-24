import { useT } from '../../i18n'
import { ColorPicker } from '../../components/ColorPicker'
import { Check, Group, Segmented, Slider } from '../../components/controls'
import { Icon } from '../../components/Icon'
import type { FontKind } from '../../lib/makeShape'
import {
  clipsOn,
  isMain,
  removeClip,
  removeKeyframe,
  setKeyframe,
  setSpeed,
  split,
  updateClip,
  valueAt,
  type AnimKind,
  type Clip,
  type ClipColor,
  type KeyProp,
  type TransitionKind,
} from '../model'
import { LOOKS } from '../render'
import { outputColors } from '../../tokens'
import { committedProject, useProject, useVideo } from '../store'

const TRANSITIONS: { value: TransitionKind | 'none'; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'dip', label: 'Dip to black' },
  { value: 'wipe', label: 'Wipe' },
  { value: 'slide', label: 'Slide' },
  { value: 'zoom', label: 'Zoom' },
]
const ANIMS: { value: AnimKind; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'rise', label: 'Rise' },
  { value: 'pop', label: 'Pop' },
  { value: 'slide', label: 'Slide' },
]

/** Live while dragging a slider, one history step when it is let go. */
function useEditClip(clip: Clip) {
  const live = (patch: Partial<Clip>) =>
    useVideo.getState().preview(updateClip(committedProject(), clip.id, patch))
  const commit = (label: string, patch: Partial<Clip>) =>
    useVideo.getState().commit(label, updateClip(committedProject(), clip.id, patch))
  return { live, commit }
}

/** A transform slider with a keyframe diamond: set or remove a keyframe at the playhead. */
function KeyedSlider(props: {
  clip: Clip
  prop: KeyProp
  label: string
  min: number
  max: number
  step?: number
  neutral: number
  unit?: string
  digits?: number
  factor?: number
}) {
  const t = useT()
  const { clip, prop } = props
  const playhead = useVideo((s) => s.playhead)
  const local = Math.min(clip.duration, Math.max(0, playhead - clip.start))
  const f = props.factor ?? 1
  const keys = clip.keys[prop] ?? []
  const here = keys.find((k) => Math.abs(k.t - local) < 1e-3)
  const value = valueAt(clip, prop, local) * f
  const write = (v: number, commit: boolean) => {
    const base = committedProject()
    const next = keys.length
      ? setKeyframe(base, clip.id, prop, local, v / f)
      : updateClip(base, clip.id, { transform: { ...clip.transform, [prop]: v / f } })
    if (commit) useVideo.getState().commit(props.label, next)
    else useVideo.getState().preview(next)
  }
  return (
    <div className="v-keyed">
      <Slider
        label={props.label}
        value={value}
        min={props.min}
        max={props.max}
        step={props.step}
        neutral={props.neutral}
        unit={props.unit}
        digits={props.digits}
        onPreview={(v) => write(v, false)}
        onCommit={(v) => write(v, true)}
      />
      <button
        type="button"
        className="v-diamond"
        data-on={!!here}
        data-animated={keys.length > 0}
        aria-pressed={!!here}
        title={here ? t('Remove the keyframe at the playhead') : t('Add a keyframe at the playhead')}
        aria-label={here ? t('Remove the keyframe at the playhead') : t('Add a keyframe at the playhead')}
        onClick={() =>
          useVideo
            .getState()
            .commit(
              'Keyframe',
              here
                ? removeKeyframe(committedProject(), clip.id, prop, here.t)
                : setKeyframe(committedProject(), clip.id, prop, local, valueAt(clip, prop, local)),
            )
        }
      >
        <Icon name="diamond" size={12} />
      </button>
    </div>
  )
}

export function Inspector() {
  const t = useT()
  const project = useProject()
  const selected = useVideo((s) => s.selected)
  const clip = project.clips.find((c) => c.id === selected)
  if (!clip) {
    return (
      <aside className="v-inspector glass" aria-label={t('Inspector')}>
        <div className="panel-head">
          <span>{t('Inspector')}</span>
        </div>
        <p className="muted v-pad">{t('Select a clip on the timeline to change it.')}</p>
      </aside>
    )
  }
  return (
    <aside className="v-inspector glass" aria-label={t('Inspector')}>
      <div className="panel-head">
        <span>{t('Inspector')}</span>
      </div>
      <div className="panel-scroll v-pad">
        <ClipSettings
          clip={clip}
          index={clipsOn(project, clip.track).findIndex((c) => c.id === clip.id)}
          main={isMain(project, clip.track)}
        />
      </div>
    </aside>
  )
}

function ClipSettings({ clip, index, main }: { clip: Clip; index: number; main: boolean }) {
  const t = useT()
  const { live, commit } = useEditClip(clip)
  const visual = clip.kind !== 'audio'
  const sound = clip.kind === 'video' || clip.kind === 'audio'
  const setColor = (k: keyof ClipColor, v: number, done: boolean) => {
    const color = { ...clip.color, [k]: v }
    if (done) commit('Colour', { color })
    else live({ color })
  }
  return (
    <>
      <div className="layers-actions">
        <button
          type="button"
          className="button"
          onClick={() =>
            useVideo
              .getState()
              .commit('Split', split(committedProject(), clip.id, useVideo.getState().playhead))
          }
        >
          <Icon name="scissors" size={14} /> {t('Split')}
        </button>
        <button
          type="button"
          className="button"
          onClick={() => {
            useVideo.getState().commit('Delete clip', removeClip(committedProject(), clip.id))
            useVideo.getState().set({ selected: null })
          }}
        >
          <Icon name="trash" size={14} /> {t('Delete')}
        </button>
      </div>

      {clip.kind === 'text' && clip.text && <TitleSettings clip={clip} />}

      {visual && (
        <Group title="Position and size">
          <KeyedSlider
            clip={clip}
            prop="scale"
            label="Scale"
            min={10}
            max={400}
            neutral={100}
            unit="%"
            factor={100}
          />
          <KeyedSlider
            clip={clip}
            prop="x"
            label="Left / right"
            min={-2000}
            max={2000}
            neutral={0}
            unit="px"
          />
          <KeyedSlider clip={clip} prop="y" label="Up / down" min={-2000} max={2000} neutral={0} unit="px" />
          <KeyedSlider
            clip={clip}
            prop="rotation"
            label="Rotation"
            min={-180}
            max={180}
            neutral={0}
            unit="°"
          />
          <KeyedSlider
            clip={clip}
            prop="opacity"
            label="Opacity"
            min={0}
            max={100}
            neutral={100}
            unit="%"
            factor={100}
          />
          {clip.kind !== 'text' && (
            <Segmented<Clip['fit']>
              label="Fit"
              value={clip.fit}
              onChange={(fit) => commit('Fit', { fit })}
              options={[
                { value: 'contain', label: 'Whole picture' },
                { value: 'cover', label: 'Fill the frame' },
              ]}
            />
          )}
        </Group>
      )}

      {sound && (
        <Group title="Speed and sound">
          <Slider
            label="Speed"
            value={clip.speed}
            min={0.25}
            max={4}
            step={0.05}
            neutral={1}
            unit="x"
            digits={2}
            onPreview={(v) => useVideo.getState().preview(setSpeed(committedProject(), clip.id, v))}
            onCommit={(v) => useVideo.getState().commit('Speed', setSpeed(committedProject(), clip.id, v))}
          />
          <Slider
            label="Volume"
            value={Math.round(clip.volume * 100)}
            min={0}
            max={200}
            neutral={100}
            unit="%"
            onPreview={(v) => live({ volume: v / 100 })}
            onCommit={(v) => commit('Volume', { volume: v / 100 })}
          />
          <Slider
            label="Fade in"
            value={clip.fadeIn}
            min={0}
            max={Math.min(10, clip.duration)}
            step={0.1}
            neutral={0}
            unit="s"
            digits={1}
            onPreview={(v) => live({ fadeIn: v })}
            onCommit={(v) => commit('Fade in', { fadeIn: v })}
          />
          <Slider
            label="Fade out"
            value={clip.fadeOut}
            min={0}
            max={Math.min(10, clip.duration)}
            step={0.1}
            neutral={0}
            unit="s"
            digits={1}
            onPreview={(v) => live({ fadeOut: v })}
            onCommit={(v) => commit('Fade out', { fadeOut: v })}
          />
          <Check
            label="Mute this clip"
            checked={clip.volume === 0}
            onChange={(on) => commit('Volume', { volume: on ? 0 : 1 })}
          />
        </Group>
      )}

      {visual && clip.kind !== 'text' && (
        <Group title="Colour">
          <div className="chips" role="group" aria-label={t('Looks')}>
            {Object.entries(LOOKS).map(([id, look]) => (
              <button
                key={id}
                type="button"
                className="chip-button"
                aria-pressed={clip.filter === id}
                data-active={clip.filter === id}
                onClick={() => commit('Look', { filter: id })}
              >
                {t(look.label)}
              </button>
            ))}
          </div>
          {(
            [
              ['exposure', 'Exposure', -3, 3, 0.05, 2],
              ['contrast', 'Contrast', -100, 100, 1, 0],
              ['saturation', 'Saturation', -100, 100, 1, 0],
              ['temperature', 'Temperature', -100, 100, 1, 0],
              ['vignette', 'Vignette', 0, 100, 1, 0],
            ] as const
          ).map(([key, label, min, max, step, digits]) => (
            <Slider
              key={key}
              label={label}
              value={clip.color[key]}
              min={min}
              max={max}
              step={step}
              digits={digits}
              neutral={0}
              onPreview={(v) => setColor(key, v, false)}
              onCommit={(v) => setColor(key, v, true)}
            />
          ))}
        </Group>
      )}

      {visual && main && index > 0 && (
        <Group title="Transition in">
          <label className="field">
            <span>{t('Transition from the previous clip')}</span>
            <span className="select-wrap">
              <select
                value={clip.transitionIn?.kind ?? 'none'}
                onChange={(e) => {
                  const kind = e.target.value as TransitionKind | 'none'
                  commit('Transition', {
                    transitionIn:
                      kind === 'none' ? null : { kind, duration: clip.transitionIn?.duration ?? 0.6 },
                  })
                }}
              >
                {TRANSITIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(o.label)}
                  </option>
                ))}
              </select>
            </span>
          </label>
          {clip.transitionIn && (
            <Slider
              label="Transition length"
              value={clip.transitionIn.duration}
              min={0.1}
              max={Math.min(3, clip.duration)}
              step={0.1}
              neutral={0.6}
              unit="s"
              digits={1}
              onPreview={(v) => live({ transitionIn: { ...clip.transitionIn!, duration: v } })}
              onCommit={(v) => commit('Transition', { transitionIn: { ...clip.transitionIn!, duration: v } })}
            />
          )}
        </Group>
      )}

      {visual && (
        <Group title="Animation">
          {(['animIn', 'animOut'] as const).map((key) => (
            <label key={key} className="field">
              <span>{t(key === 'animIn' ? 'Entrance' : 'Exit')}</span>
              <span className="select-wrap">
                <select
                  value={clip[key]}
                  onChange={(e) => commit('Animation', { [key]: e.target.value as AnimKind })}
                >
                  {ANIMS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.label)}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          ))}
        </Group>
      )}
    </>
  )
}

const FONTS: { value: FontKind; label: string }[] = [
  { value: 'arabic', label: 'Arabic' },
  { value: 'sans', label: 'Sans-serif' },
  { value: 'display', label: 'Display' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Monospace' },
]

function TitleSettings({ clip }: { clip: Clip }) {
  const t = useT()
  const { live, commit } = useEditClip(clip)
  const text = clip.text!
  const patch = (p: Partial<typeof text>, done: boolean) => {
    const next = { text: { ...text, ...p } }
    if (done) commit('Title', next)
    else live(next)
  }
  return (
    <Group title="Title">
      <label className="field">
        <span>{t('Text')}</span>
        <textarea
          className="text-input"
          rows={2}
          maxLength={400}
          dir="auto"
          value={text.text}
          onChange={(e) => patch({ text: e.target.value }, false)}
          onBlur={(e) => patch({ text: e.target.value }, true)}
        />
      </label>
      <label className="field">
        <span>{t('Font')}</span>
        <span className="select-wrap">
          <select value={text.font} onChange={(e) => patch({ font: e.target.value as FontKind }, true)}>
            {FONTS.map((f) => (
              <option key={f.value} value={f.value}>
                {t(f.label)}
              </option>
            ))}
          </select>
        </span>
      </label>
      <Slider
        label="Text size"
        value={text.size}
        min={12}
        max={400}
        neutral={90}
        unit="px"
        onPreview={(v) => patch({ size: v }, false)}
        onCommit={(v) => patch({ size: v }, true)}
      />
      <ColorPicker label="Text colour" value={text.color} onChange={(color) => patch({ color }, true)} />
      <Check label="Bold" checked={text.bold} onChange={(bold) => patch({ bold }, true)} />
      <Check
        label="Outline"
        checked={!!text.outline}
        onChange={(on) =>
          patch(
            { outline: on ? { width: Math.round(text.size / 14), color: `${outputColors.black}cc` } : null },
            true,
          )
        }
      />
      <Check
        label="Background box"
        checked={!!text.background}
        onChange={(on) =>
          patch(
            {
              background: on
                ? {
                    color: `${outputColors.black}a6`,
                    padding: Math.round(text.size / 4),
                    radius: Math.round(text.size / 5),
                  }
                : null,
            },
            true,
          )
        }
      />
    </Group>
  )
}

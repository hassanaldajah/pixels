import { useMemo, useState } from 'react'
import { RejectionError } from '../api/client'
import { defaultExportOptions, exportIcons, exportSizes, runBatch, saveBlob, type Recipe } from '../api/edit'
import { useCapabilities } from '../api/queries'
import { committedState, displayedState } from '../state/edit'
import { useImage } from '../state/image'
import { useJobs } from '../state/jobs'
import { outputColors } from '../tokens'
import { Check, Field, Group, Segmented } from './controls'
import { Icon } from './Icon'

type Tab = 'icons' | 'sizes' | 'batch'
const PLATFORM_LABELS: Record<string, string> = {
  ios: 'iOS',
  android: 'Android (adaptive)',
  macos: 'macOS .icns',
  windows: 'Windows .ico',
  web: 'Favicons',
  pwa: 'PWA',
}
const RECIPES_KEY = 'pixels.recipes'

function loadRecipes(): Recipe[] {
  try {
    return JSON.parse(localStorage.getItem(RECIPES_KEY) ?? '[]') as Recipe[]
  } catch {
    return []
  }
}
const storeRecipes = (list: Recipe[]) => {
  try {
    localStorage.setItem(RECIPES_KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable */
  }
}

function useRun() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const run = async (work: () => Promise<{ blob: Blob; filename: string }>) => {
    setBusy(true)
    setMessage(null)
    try {
      const { blob, filename } = await work()
      saveBlob(blob, filename)
      setMessage({ kind: 'ok', text: `Saved ${filename} (${(blob.size / 1024 / 1024).toFixed(2)} MB)` })
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof RejectionError ? e.message : 'The export failed.' })
    } finally {
      setBusy(false)
    }
  }
  return { busy, message, run }
}

const Message = ({ m }: { m: ReturnType<typeof useRun>['message'] }) =>
  m && (
    <p className={m.kind === 'ok' ? 'success' : 'error'} role={m.kind === 'ok' ? 'status' : 'alert'}>
      {m.text}
    </p>
  )

function Icons() {
  const caps = useCapabilities()
  const image = useImage((s) => s.current)
  const { busy, message, run } = useRun()
  const [platforms, setPlatforms] = useState<string[]>(['ios', 'android', 'macos', 'windows', 'web', 'pwa'])
  const [background, setBackground] = useState<string>(outputColors.black)
  const [fit, setFit] = useState<'cover' | 'contain'>('cover')
  const toggle = (p: string) => setPlatforms((l) => (l.includes(p) ? l.filter((x) => x !== p) : [...l, p]))
  return (
    <>
      <Group title="App icon set">
        <p className="hint">
          Builds every size from your picture (made square first). Use a 1024 px or larger source for the
          sharpest result.
        </p>
        {(caps.data?.platforms ?? Object.keys(PLATFORM_LABELS)).map((p) => (
          <Check
            key={p}
            label={PLATFORM_LABELS[p] ?? p}
            checked={platforms.includes(p)}
            onChange={() => toggle(p)}
          />
        ))}
        <Field label="Make it square by">
          <Segmented
            label="Square"
            value={fit}
            onChange={setFit}
            options={[
              { value: 'cover', label: 'Cropping' },
              { value: 'contain', label: 'Padding' },
            ]}
          />
        </Field>
        <Field label="Background (iOS, Android adaptive, padding)">
          <input
            type="color"
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            aria-label="Icon background colour"
          />
        </Field>
      </Group>
      <button
        type="button"
        className="button button-primary"
        disabled={busy || !image || platforms.length === 0}
        onClick={() =>
          image && void run(() => exportIcons(image.id, displayedState(), { platforms, background, fit }))
        }
      >
        <Icon name="export" size={15} /> {busy ? 'Building…' : 'Download icon set (.zip)'}
      </button>
      <Message m={message} />
    </>
  )
}

function Sizes() {
  const caps = useCapabilities()
  const image = useImage((s) => s.current)
  const { busy, message, run } = useRun()
  const [ids, setIds] = useState<string[]>([])
  const [mode, setMode] = useState<'cover' | 'contain'>('cover')
  const [focusX, setFocusX] = useState(0.5)
  const [focusY, setFocusY] = useState(0.5)
  const [background, setBackground] = useState<string>(outputColors.black)
  const [format, setFormat] = useState<'png' | 'jpeg' | 'webp'>('png')
  const groups = useMemo(() => {
    const map = new Map<string, NonNullable<typeof caps.data>['size_presets']>()
    for (const p of caps.data?.size_presets ?? []) map.set(p.group, [...(map.get(p.group) ?? []), p])
    return [...map.entries()]
  }, [caps])
  return (
    <>
      {groups.map(([group, items]) => (
        <Group key={group} title={group}>
          {items.map((p) => (
            <Check
              key={p.id}
              label={`${p.label} · ${p.w} × ${p.h}`}
              checked={ids.includes(p.id)}
              onChange={(on) => setIds((l) => (on ? [...l, p.id] : l.filter((x) => x !== p.id)))}
            />
          ))}
        </Group>
      ))}
      <Group title="How to fit">
        <Segmented
          label="Fit"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'cover', label: 'Fill (crop)' },
            { value: 'contain', label: 'Fit (bars)' },
          ]}
        />
        {mode === 'cover' ? (
          <>
            <Field label={`Focus left-right ${Math.round(focusX * 100)}%`}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={focusX}
                onChange={(e) => setFocusX(Number(e.target.value))}
              />
            </Field>
            <Field label={`Focus top-bottom ${Math.round(focusY * 100)}%`}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={focusY}
                onChange={(e) => setFocusY(Number(e.target.value))}
              />
            </Field>
          </>
        ) : (
          <Field label="Bar colour">
            <input
              type="color"
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              aria-label="Bar colour"
            />
          </Field>
        )}
        <Field label="Format">
          <Segmented
            label="Format"
            value={format}
            onChange={setFormat}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPEG' },
              { value: 'webp', label: 'WebP' },
            ]}
          />
        </Field>
      </Group>
      <button
        type="button"
        className="button button-primary"
        disabled={busy || !image || ids.length === 0}
        onClick={() =>
          image &&
          void run(() =>
            exportSizes(image.id, displayedState(), {
              ids,
              mode,
              focus_x: focusX,
              focus_y: focusY,
              background: mode === 'contain' ? background : null,
              export: { ...defaultExportOptions(), format, quality: 92 },
            }),
          )
        }
      >
        <Icon name="export" size={15} />{' '}
        {busy ? 'Rendering…' : `Download ${ids.length || ''} size${ids.length === 1 ? '' : 's'} (.zip)`}
      </button>
      <Message m={message} />
    </>
  )
}

function Batch() {
  const jobs = useJobs((s) => s.jobs)
  const { busy, message, run } = useRun()
  const sessionImages = useMemo(() => jobs.filter((j) => j.status === 'done' && j.image_id), [jobs])
  const [picked, setPicked] = useState<string[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>(loadRecipes)
  const [selected, setSelected] = useState<string>('')
  const [name, setName] = useState('My recipe')
  const [layout, setLayout] = useState<'none' | 'pad_square' | 'fit'>('none')
  const [fitW, setFitW] = useState(1200)
  const [fitH, setFitH] = useState(630)
  const [format, setFormat] = useState<'png' | 'jpeg' | 'webp'>('webp')
  const [suffix, setSuffix] = useState('_edited')

  const recipeFromCurrent = (): Recipe => ({
    name: name.trim() || 'Recipe',
    orientation: committedState().geometry.filter(
      (g): g is Extract<typeof g, { type: 'rotate90' | 'flip' }> =>
        g.type === 'rotate90' || g.type === 'flip',
    ),
    layout:
      layout === 'none'
        ? { type: 'none' }
        : layout === 'pad_square'
          ? { type: 'pad_square', fill: null }
          : { type: 'fit', w: fitW, h: fitH, mode: 'cover', fill: null, focus_x: 0.5, focus_y: 0.5 },
    adjust: displayedState().adjust,
    export: { ...defaultExportOptions(), format, quality: 90 },
    suffix: suffix.replace(/[^A-Za-z0-9_.-]/g, ''),
  })
  const save = () => {
    const recipe = recipeFromCurrent()
    const next = [...recipes.filter((r) => r.name !== recipe.name), recipe]
    setRecipes(next)
    storeRecipes(next)
    setSelected(recipe.name)
  }
  const remove = () => {
    const next = recipes.filter((r) => r.name !== selected)
    setRecipes(next)
    storeRecipes(next)
    setSelected('')
  }
  const chosen = recipes.find((r) => r.name === selected)
  const ids = picked.length ? picked : sessionImages.map((j) => j.image_id as string)

  return (
    <>
      <Group title="1. Recipe">
        <p className="hint">
          A recipe remembers the current adjustments, any rotation or flip, a layout and the export format.
          Rotation and flips come from your edit stack; crops are not saved because they only fit one picture.
        </p>
        <Field label="Name">
          <input type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Layout">
          <Segmented
            label="Layout"
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'none', label: 'Keep' },
              { value: 'pad_square', label: 'Pad to 1:1' },
              { value: 'fit', label: 'Fit to size' },
            ]}
          />
        </Field>
        {layout === 'fit' && (
          <div className="inline-fields">
            <Field label="Width">
              <input
                type="number"
                min={1}
                max={20000}
                value={fitW}
                onChange={(e) => setFitW(Math.max(1, Number(e.target.value)))}
              />
            </Field>
            <Field label="Height">
              <input
                type="number"
                min={1}
                max={20000}
                value={fitH}
                onChange={(e) => setFitH(Math.max(1, Number(e.target.value)))}
              />
            </Field>
          </div>
        )}
        <Field label="Format">
          <Segmented
            label="Format"
            value={format}
            onChange={setFormat}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPEG' },
              { value: 'webp', label: 'WebP' },
            ]}
          />
        </Field>
        <Field label="File name suffix">
          <input type="text" value={suffix} maxLength={40} onChange={(e) => setSuffix(e.target.value)} />
        </Field>
        <button type="button" className="button" onClick={save}>
          Save recipe
        </button>
      </Group>
      <Group title="2. Apply to images">
        <Field label="Saved recipes">
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Choose…</option>
            {recipes.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        {sessionImages.length === 0 ? (
          <p className="hint">
            Open several images first (select many files, or drop a folder's files). Each one passes the
            Security Gate, then appears here.
          </p>
        ) : (
          sessionImages.map((j) => (
            <Check
              key={j.id}
              label={j.name}
              checked={picked.length === 0 || picked.includes(j.image_id as string)}
              onChange={(on) =>
                setPicked((cur) => {
                  const all = cur.length ? cur : sessionImages.map((x) => x.image_id as string)
                  return on
                    ? [...new Set([...all, j.image_id as string])]
                    : all.filter((x) => x !== j.image_id)
                })
              }
            />
          ))
        )}
        <div className="actions">
          <button
            type="button"
            className="button button-primary"
            disabled={busy || !chosen || ids.length === 0}
            onClick={() =>
              chosen && void run(() => runBatch(ids, chosen, crypto.randomUUID().replaceAll('-', '')))
            }
          >
            {busy ? 'Processing…' : `Run on ${ids.length} image${ids.length === 1 ? '' : 's'}`}
          </button>
          <button type="button" className="button" disabled={!chosen} onClick={remove}>
            Delete recipe
          </button>
        </div>
        <Message m={message} />
        <p className="hint">The zip includes report.json with the security verdict for every file.</p>
      </Group>
    </>
  )
}

export function PresetsPanel() {
  const [tab, setTab] = useState<Tab>('icons')
  return (
    <div className="tool-panel">
      <div className="tool-panel-head">
        <h4>Presets & batch</h4>
      </div>
      <Segmented
        label="Preset type"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'icons', label: 'App icons' },
          { value: 'sizes', label: 'Store & social' },
          { value: 'batch', label: 'Batch' },
        ]}
      />
      {tab === 'icons' && <Icons />}
      {tab === 'sizes' && <Sizes />}
      {tab === 'batch' && <Batch />}
      <p className="hint">Device mockups (a screenshot inside a phone or laptop frame) are planned.</p>
    </div>
  )
}

import gsap from 'gsap'
import { useEffect, useRef } from 'react'
import {
  AdditiveBlending,
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Path,
  PointLight,
  Scene,
  SRGBColorSpace,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js'
import { cssColorToRgba } from '../lib/color'
import { wordmark } from './wordmark.generated'

/**
 * The opening animation, in real 3D (Three.js), built on the same ideas as the FC tool's opening:
 * calm, spring-smooth motion and light that moves with the pointer.
 *
 *  1. The blue word fades in.
 *  2. A warm-white glow travels from the "p" to the "s"; every letter it passes turns pale ice blue.
 *  3. A rounded frame of light opens around the word and drifts outward.
 *  4. A single soft sheen glides across the finished word, which then keeps a slow, quiet glow.
 *  Throughout, a soft light follows the pointer and the whole word tilts a few degrees toward it.
 *
 * The letters are the traced wordmark, extruded into solid, bevelled shapes.
 */
const DEPTH = 70
const TILT_DEGREES = 5
/** The sheen: a wide, faint diagonal band in world space, like light moving across brushed metal. */
const SHEEN_WIDTH = 300
const SHEEN_STRENGTH = 0.16
const SHEEN_SLANT = 0.5
const RING_RADIUS = wordmark.width * 0.62
/** The frame is a rounded rectangle (like the app's own corners): 1 unit half-width, this much half-height. */
const FRAME_HEIGHT = 0.4
const FRAME_CORNER = 0.26
const FRAME_LINE = 0.028

function roundedRect(path: Path, hw: number, hh: number, r: number): void {
  path.moveTo(-hw + r, -hh)
  path.lineTo(hw - r, -hh)
  path.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0, false)
  path.lineTo(hw, hh - r)
  path.absarc(hw - r, hh - r, r, 0, Math.PI / 2, false)
  path.lineTo(-hw + r, hh)
  path.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI, false)
  path.lineTo(-hw, -hh + r)
  path.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5, false)
}

interface Letter {
  group: Group
  material: MeshPhysicalMaterial
  homeX: number
  base: Color
}

function token(name: string): Color {
  const [r, g, b] = cssColorToRgba(getComputedStyle(document.documentElement).getPropertyValue(name))
  // CSS colours are sRGB; Three.js works in linear light, so convert (otherwise every colour comes out washed out)
  return new Color().setRGB(r, g, b, SRGBColorSpace)
}

/** Split the word's shapes into letters: shapes whose x-ranges overlap belong to the same letter (the dot of the i). */
function groupLetters(shapes: Shape[]): Shape[][] {
  const boxes = shapes.map((shape) => {
    const points = shape.getPoints(8)
    const xs = points.map((p) => p.x)
    return { shape, min: Math.min(...xs), max: Math.max(...xs) }
  })
  boxes.sort((a, b) => a.min - b.min)
  const clusters: { min: number; max: number; shapes: Shape[] }[] = []
  for (const box of boxes) {
    const last = clusters[clusters.length - 1]
    if (last && box.min <= last.max + 4) {
      last.shapes.push(box.shape)
      last.max = Math.max(last.max, box.max)
    } else clusters.push({ min: box.min, max: box.max, shapes: [box.shape] })
  }
  return clusters.map((c) => c.shapes)
}

export function Splash3D({
  onDone,
  onReveal,
  onUnsupported,
}: {
  onDone: () => void
  onReveal?: () => void
  onUnsupported: () => void
}) {
  const reveal$ = useRef(onReveal)
  reveal$.current = onReveal
  const host = useRef<HTMLDivElement>(null)
  const finished = useRef(false)
  const finish = useRef(() => {
    if (finished.current) return
    finished.current = true
    onDone()
  })

  useEffect(() => {
    const skip = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish.current()
    }
    window.addEventListener('keydown', skip)
    return () => window.removeEventListener('keydown', skip)
  }, [])

  useEffect(() => {
    const container = host.current
    if (!container) return
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch {
      onUnsupported()
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    container.appendChild(renderer.domElement)
    renderer.domElement.className = 'splash3d-canvas'

    const scene = new Scene()
    const camera = new PerspectiveCamera(32, 1, 10, 20000)
    const pmrem = new PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.45

    const accent = token('--px-accent')
    const soft = token('--px-accent-soft')
    const glow = token('--px-accent-glow')
    const deep = token('--px-accent-deep')
    const white = token('--px-text1')
    const ice = soft.clone().lerp(white, 0.3)

    scene.add(new AmbientLight(accent, 0.35))
    const key = new DirectionalLight(accent, 1.0)
    key.position.set(-400, 600, 800)
    scene.add(key)
    const rim = new DirectionalLight(glow, 1.2)
    rim.position.set(500, -200, -600)
    scene.add(rim)
    // the light that follows the pointer
    const cursorLight = new PointLight(accent, 0, 3200, 1.2)
    scene.add(cursorLight)

    // ---- the letters, extruded from the traced wordmark -----------------------------------------
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="${wordmark.d}"/></svg>`
    const shapes = new SVGLoader().parse(svg).paths.flatMap((path) => path.toShapes())
    const letters: Letter[] = []
    const sheen = {
      uPos: { value: -4000 },
      uWidth: { value: SHEEN_WIDTH },
      uStrength: { value: SHEEN_STRENGTH },
      uSlant: { value: SHEEN_SLANT },
      uColor: { value: accent.clone().lerp(white, 0.35) },
    }
    const pivot = new Group() // tilts toward the pointer
    const word = new Group()
    word.scale.y = -1 // SVG y points down
    pivot.add(word)
    scene.add(pivot)
    const geometries: ExtrudeGeometry[] = []
    const materials: MeshPhysicalMaterial[] = []
    for (const letterShapes of groupLetters(shapes)) {
      const geometry = new ExtrudeGeometry(letterShapes, {
        depth: DEPTH,
        bevelEnabled: true,
        bevelThickness: 7,
        bevelSize: 5,
        bevelSegments: 5,
        curveSegments: 20,
      })
      geometry.computeBoundingBox()
      const box = geometry.boundingBox ?? new Box3()
      const centre = box.getCenter(new Vector3())
      geometry.translate(-centre.x, -centre.y, -centre.z)
      const base = accent.clone().lerp(deep, 0.3)
      const material = new MeshPhysicalMaterial({
        color: base.clone(),
        metalness: 0.5,
        roughness: 0.34,
        clearcoat: 0.6,
        clearcoatRoughness: 0.25,
        emissive: deep,
        emissiveIntensity: 0.22,
        transparent: true,
        opacity: 0,
      })
      // add the sheen to the standard material: a soft band in world space that brightens the surface
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, sheen)
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vSheenPos;')
          .replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\nvSheenPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
          )
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            '#include <common>\nvarying vec3 vSheenPos;\nuniform float uPos; uniform float uWidth; uniform float uStrength; uniform float uSlant; uniform vec3 uColor;',
          )
          .replace(
            '#include <opaque_fragment>',
            'float sheenD = (vSheenPos.x + vSheenPos.y * uSlant - uPos) / uWidth;\n  outgoingLight += uColor * exp(-sheenD * sheenD) * uStrength;\n  #include <opaque_fragment>',
          )
      }
      const group = new Group()
      group.add(new Mesh(geometry, material))
      group.position.set(centre.x, centre.y, 0)
      word.add(group)
      geometries.push(geometry)
      materials.push(material)
      letters.push({ group, material, homeX: centre.x, base })
    }
    const wordBox = new Box3().setFromObject(word)
    const wordCentre = wordBox.getCenter(new Vector3())
    word.position.set(-wordCentre.x, -wordCentre.y, -DEPTH / 2)
    if (letters.length !== 6) console.warn(`Splash: expected 6 letters, found ${letters.length}`)

    // a rounded frame of light that opens around the word and drifts outward
    const ringMaterial = new MeshBasicMaterial({
      color: soft,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    const frameShape = new Shape()
    roundedRect(frameShape, 1, FRAME_HEIGHT, FRAME_CORNER)
    const frameHole = new Path()
    roundedRect(frameHole, 1 - FRAME_LINE, FRAME_HEIGHT - FRAME_LINE, FRAME_CORNER - FRAME_LINE)
    frameShape.holes.push(frameHole)
    const ring = new Mesh(new ShapeGeometry(frameShape, 24), ringMaterial)
    ring.position.z = -DEPTH
    ring.scale.setScalar(RING_RADIUS * 0.6)
    scene.add(ring)

    // ---- post-processing: a faint, constant glow ------------------------------------------------
    const composer = new EffectComposer(renderer)
    const bloom = new UnrealBloomPass(new Vector2(256, 256), 0.18, 0.5, 0.85)
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(bloom)
    composer.addPass(new OutputPass())

    const baseDistance = () => {
      const vfov = (camera.fov * Math.PI) / 180
      const fitWidth = (wordmark.width * 1.55) / (2 * Math.tan(vfov / 2) * camera.aspect)
      const fitHeight = (wordmark.height * 2.6) / (2 * Math.tan(vfov / 2))
      return Math.max(fitWidth, fitHeight)
    }
    const resize = () => {
      const w = container.clientWidth || window.innerWidth
      const h = container.clientHeight || window.innerHeight
      renderer.setSize(w, h, false)
      composer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    window.addEventListener('resize', resize)

    // ---- pointer: eased like a spring; drifts by itself until the mouse moves -------------------
    const pointer = { x: 0, y: 0, tx: 0, ty: 0, moved: false }
    const onPointer = (e: PointerEvent) => {
      pointer.moved = true
      pointer.tx = (e.clientX / window.innerWidth - 0.5) * 2
      pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2
    }
    window.addEventListener('pointermove', onPointer)

    const state = { dolly: 1.06, clock: 0, wave: 0, sweep: -1, bloom: 0.18, calm: 0 }
    const span = wordmark.width * 0.62
    for (const letter of letters) letter.group.scale.setScalar(0.96)

    const lookAt = new Vector3()
    const update = (dt: number) => {
      state.clock += dt
      const t = state.clock
      if (!pointer.moved) {
        pointer.tx = Math.sin(t * 0.75) * 0.6
        pointer.ty = Math.cos(t * 0.55) * 0.35
      }
      const ease = 1 - Math.exp(-dt * 3.4)
      pointer.x += (pointer.tx - pointer.x) * ease
      pointer.y += (pointer.ty - pointer.y) * ease
      pivot.rotation.x = (-TILT_DEGREES * pointer.y * Math.PI) / 180
      pivot.rotation.y = (TILT_DEGREES * pointer.x * Math.PI) / 180
      cursorLight.position.set(pointer.x * wordmark.width * 0.55, -pointer.y * wordmark.height * 1.4, 620)
      camera.position.set(0, 0, baseDistance() * state.dolly)
      camera.lookAt(lookAt)
      const wave = state.wave
      const grow = RING_RADIUS * (0.6 + 1.1 * wave)
      ring.scale.setScalar(grow)
      // fades in quickly, then thins out as it drifts away
      ringMaterial.opacity =
        wave > 0 && wave < 1 ? Math.min(1, wave / 0.18) * (1 - wave) * (1 - wave) * 0.4 : 0
      bloom.strength = state.bloom
      const breathe = 0.36 + 0.05 * Math.sin(t * 1.5) * state.calm
      for (const letter of letters) {
        // how far the travelling glow is past this letter: 0 before it, 1 after it
        const d = (state.sweep * span - (letter.homeX - wordCentre.x)) / (wordmark.width * 0.2)
        const turned = Math.min(1, Math.max(0, d * 0.5 + 0.5))
        const smooth = turned * turned * (3 - 2 * turned)
        const peak = Math.exp(-d * d)
        letter.material.color.copy(letter.base).lerp(ice, smooth)
        letter.material.emissive.copy(deep).lerp(ice, smooth * 0.55)
        letter.material.emissiveIntensity = 0.22 + (breathe - 0.22) * smooth + peak * 0.5
      }
    }

    let frame = 0
    let last = -1
    const render = (now: number) => {
      frame = requestAnimationFrame(render)
      if (last < 0) last = now
      // rAF timestamps can be slightly older than performance.now() on the first frames: never let time go backwards
      update(Math.max(0, Math.min(0.05, (now - last) / 1000)))
      last = now
      composer.render()
    }
    frame = requestAnimationFrame(render)

    // ---- the timeline: one long, smooth curve for everything (quint ease-out, like FC) ---------
    const seek = Number(sessionStorage.getItem('pixels.splash.seek'))
    const timeline = gsap.timeline({ onComplete: () => finish.current() })
    timeline
      .fromTo(container, { opacity: 0 }, { opacity: 1, duration: 0.45, ease: 'power2.out' }, 0)
      .to(cursorLight, { intensity: 3200, duration: 1.4, ease: 'power2.out' }, 0.2)
      .to(state, { dolly: 1, duration: 3.4, ease: 'power2.out' }, 0)
      // 1. the blue word fades in
      .to(
        letters.map((l) => l.material),
        { opacity: 1, duration: 0.6, ease: 'power1.out', stagger: 0.04 },
        0.1,
      )
      .to(
        letters.map((l) => l.group.scale),
        { x: 1, y: 1, z: 1, duration: 0.9, ease: 'power4.out', stagger: 0.04 },
        0.1,
      )
      // 2. the glow travels from the "p" to the "s", turning every letter pale blue
      .fromTo(state, { sweep: -1 }, { sweep: 1.15, duration: 1.5, ease: 'power2.inOut' }, 0.8)
      .to(state, { bloom: 0.34, duration: 0.75, ease: 'sine.out' }, 0.8)
      .to(state, { bloom: 0.2, duration: 1.2, ease: 'sine.inOut' }, 1.55)
      // 3. the rounded frame opens around the word and drifts outward
      .to(state, { wave: 1, duration: 2.0, ease: 'power2.out' }, 1.25)
      // 4. one very soft sheen glides across the finished word, then a slow, quiet glow stays
      .fromTo(
        sheen.uPos,
        { value: -span * 1.4 },
        { value: span * 1.4, duration: 1.2, ease: 'sine.inOut' },
        2.6,
      )
      .to(state, { calm: 1, duration: 0.8 }, 2.6)
      // 5. a calm hold, then the word moves toward the viewer and dissolves while the app glides in
      .call(() => reveal$.current?.(), [], 4.0)
      .to(state, { dolly: 0.84, duration: 0.85, ease: 'power3.in' }, 4.0)
      .to(cursorLight, { intensity: 0, duration: 0.6 }, 4.0)
      .to(container, { opacity: 0, duration: 0.6, ease: 'power2.inOut' }, 4.25)
    if (localStorage.getItem('pixels.e2e') === '1') {
      ;(window as unknown as { __pixelsSplash: unknown }).__pixelsSplash = {
        seek: (time: number) => {
          timeline.pause().seek(time)
          update(0)
          composer.render()
        },
        debug: () => ({
          pivot: [pivot.rotation.x, pivot.rotation.y, pivot.rotation.z],
          pointer: [pointer.x, pointer.y, pointer.tx, pointer.ty],
          clock: state.clock,
          dolly: state.dolly,
          letters: letters.map((l) => [
            l.group.rotation.x,
            l.group.rotation.y,
            l.group.rotation.z,
            l.group.scale.x,
          ]),
        }),
      }
      if (Number.isFinite(seek) && seek > 0) timeline.pause().seek(seek)
    }

    return () => {
      cancelAnimationFrame(frame)
      timeline.kill()
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointer)
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
      ring.geometry.dispose()
      ringMaterial.dispose()
      pmrem.dispose()
      composer.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [onUnsupported])

  return (
    <div className="splash splash3d" role="presentation" onClick={() => finish.current()}>
      <div className="splash-glow" />
      <div ref={host} className="splash3d-host" />
      <div className="splash-hint">Click or press Esc to skip</div>
    </div>
  )
}

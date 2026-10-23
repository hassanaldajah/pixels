# pixels user guide

Generated from `apps/web/src/help/guide.ts`. Do not edit by hand.

## Contents

- [Getting started](#start)
- [Opening pictures safely](#security)
- [The workspace](#workspace)
- [Undo, redo and history](#history)
- [Transform: crop, rotate, resize](#transform)
- [Adjust: light, colour, detail](#adjust)
- [Eraser: remove things](#eraser)
- [Brush: paint light and colour](#brush)
- [Clone: copy one part onto another](#clone)
- [Retouch: heal, smooth, cut out](#retouch)
- [Pixel Art](#pixelart)
- [Upscale](#upscale)
- [Selection: limit the adjustments](#selection)
- [Local adjustments](#local)
- [Layers](#layers)
- [Text and shapes](#text)
- [Saving and exporting](#save)
- [Keyboard shortcuts](#shortcuts)
- [Problems and answers](#help)

<a id="start"></a>

## Getting started

*Open a picture, change it, save it.*

pixels is an image editor that runs entirely on your computer. It works offline, needs no account, and sends nothing anywhere. There is no AI in it: every tool uses ordinary, predictable maths.

1. Open a picture: drag a file onto the window, paste from the clipboard (Ctrl+V), or press Open (Ctrl+O).
2. Pick a tool on the left, or press its letter key. Its controls appear in the Inspector on the right.
3. Look at the result as you go. Hold the backslash key (\) to see the original, or use Split / Side in the top bar.
4. Save your work: Export for a finished picture, or Save project to keep editing later.

> **Tip:** Nothing you do changes your original file. Edits are kept as a list of steps, so you can always go back.

<a id="security"></a>

## Opening pictures safely

*Every file is checked before you see it.*

A picture can hide trouble: a fake file type, a decompression bomb, a program tucked inside. So pixels treats every file as untrusted. Before it appears, the file is checked by its real bytes, scanned for hidden payloads and malware, opened in a locked-down helper process, and saved again as a clean PNG with all metadata removed.

- The "Security report" in the Inspector lists every check and its result.
- If a file fails a check it is refused, with the reason in plain words.
- "Hidden data" in the Inspector: pixels screens every picture for data hidden in its pixel values. "Looks suspicious" is a warning, not a refusal: noisy photos can look similar.
- "SHA-256" in the Inspector is the fingerprint of the original file. The VirusTotal link next to it looks that fingerprint up; the picture itself is never uploaded.
- Supported: PNG, JPEG, WebP, TIFF, BMP, HEIC, AVIF. Large files are capped for safety.
- Camera information (model, exposure, date) is removed on opening. You can choose to put a short, checked list of it back when you export. GPS stays off unless you switch it on.

<a id="workspace"></a>

## The workspace

*Tool rail, canvas, Inspector, history.*

- Tool rail (left): the tools. Each has a letter key.
- Canvas (middle): your picture. Scroll to zoom, hold Space and drag (or use the middle mouse button) to move around, double-click to fit the picture to the window.
- Inspector (right): the controls for the current tool, plus Image facts, Histogram, Security report, Selection, Local adjustments, Layers and History.
- Top bar: Undo / Redo, Edit / Split / Side views, zoom, preview quality, Open, Save project and Export.
- Rulers and guides: drag from a ruler to pull out a guide. Drag it back out to remove it.

Preview quality (top bar) only changes how sharp the on-screen preview is while you work. Export always uses the full resolution.

> **Tip:** Press Ctrl+K for the command palette: type what you want to do and press Enter.

<a id="history"></a>

## Undo, redo and history

*Every step is kept.*

- Ctrl+Z goes back one step. Ctrl+Shift+Z (or Ctrl+Y) goes forward.
- The History list in the Inspector shows every step. Click one to jump back to it.
- Dragging a slider counts as one step, however long you drag.
- Eraser, Retouch and Upscale create a new version of the picture. Their own "Undo last change" button returns to the version before.

<a id="transform"></a>

## Transform: crop, rotate, resize

*Change the shape and size.*

- Crop with ratio presets (1:1, 4:3, 16:9...) or exact sizes in pixels, centimetres or inches.
- Rotate in quarter turns or any angle, and flip horizontally or vertically.
- Straighten: type an angle, or let pixels find the horizon, or draw a line along it.
- Skew and four-point perspective fix leaning buildings and tilted documents.
- Canvas size adds or removes space around the picture. Picture size resizes it.

> **Tip:** Transform steps are applied in the order you make them. The History list shows that order.

<a id="adjust"></a>

## Adjust: light, colour, detail

*The everyday fixes.*

- Light: Exposure, Contrast, Highlights, Shadows, Whites, Blacks.
- Colour: Temperature (warm / cool), Tint (green / magenta), Vibrance (boosts dull colours gently), Saturation.
- HSL: change Hue, Saturation and Lightness of eight colour ranges separately (for example make only the blues deeper).
- Curves and Levels: precise control of the tone range. Click a curve to add a point, drag it, and drag a point off to remove it.
- Detail: Noise reduction (keeps edges), Blur, Sharpen (amount, radius, threshold).
- Finish: Vignette (darken or lighten the corners) and Grain (film texture).

Double-click any slider to put it back to zero. You can also type an exact number.

> **Tip:** The preview and the exported file use matching maths, so what you see is what you get (they agree to within 1 level out of 255).

<a id="eraser"></a>

## Eraser: remove things

*Paint over it and it is gone.*

1. Choose the Eraser (E).
2. Paint over the thing you want removed. Hold Alt to rub paint out if you went too far.
3. Press Remove. The gap is filled in from the surrounding texture.

- Fast is quick; High quality takes longer and usually looks better.
- "Grow edge" widens your painted area a little so shadows and soft edges go too. "Soften seam" blends the fill into its surroundings.
- "Undo last removal" goes back to the version before.

It cannot invent something that was never there. It works best on small objects against a plain or textured background (wires, spots, people far away).

<a id="brush"></a>

## Brush: paint light and colour

*Dodge, burn, eyes, teeth.*

The Brush changes light or colour only where you paint. Pick an effect, set the size, then paint on the picture. You see the change as you paint.

- Dodge lightens. Burn darkens.
- Brighten eyes adds a little light and contrast. Whiten teeth removes yellow and brightens.
- Warm glow, Soften and Blur are for mood and for hiding detail.
- Size, Hardness (how sharp the brush edge is), Flow (how fast paint builds up) and Strength (how strong the effect is).
- Hold Alt to rub paint out.

pixels does not find faces or eyes by itself. You choose where to paint. Each painted area is a "local adjustment": you can fine-tune its light and colour later under Local adjustments in the Inspector.

> **Tip:** Use a low Flow and paint in several passes for natural results.

<a id="clone"></a>

## Clone: copy one part onto another

*Remove blemishes, extend textures.*

1. Choose Clone (S).
2. Hold Alt and click the place you want to copy from. A small cross marks it.
3. Release Alt and paint where the copy should go.

- The distance between source and where you paint stays the same for later strokes, so you can keep painting across an area. Alt+click again to choose a new source.
- "Forget source" clears it. "Clear all clones" removes every clone stroke.
- Clone strokes are applied before your other adjustments, so colour changes still apply on top.

<a id="retouch"></a>

## Retouch: heal, smooth, cut out

*Spots, skin, plain backgrounds.*

- Heal spots: paint over a spot or blemish and press Heal. It is filled from the area around it.
- Smooth skin softens skin while keeping eyes, hair and edges sharp.
- Remove background cuts out a plain background (a studio shot, a screenshot) and leaves it transparent, with a soft edge you can adjust.

> **Tip:** Remove background works best when the background is one even colour. A busy background will not cut out cleanly.

<a id="pixelart"></a>

## Pixel Art

*Turn any picture into pixel art.*

- Pixel size: how big each "pixel" is in the picture.
- Palette: Automatic (picked from the picture), or classic sets: Game Boy, PICO-8, NES, Commodore 64, CGA, Endesga 32. You can also import your own .hex or .gpl palette.
- Dithering (ordered 2/4/8, Floyd-Steinberg, Atkinson) simulates more colours with patterns of dots.
- Outline draws a border around shapes.
- Export as the tiny 1x sprite, or scaled up with crisp blocks.

<a id="upscale"></a>

## Upscale

*Make a picture bigger.*

Enlarges up to 4 times with high-quality resampling and a careful sharpening pass that avoids bright or dark halos around edges.

Honest limit: it cannot add detail that was never in the picture. A small, blurry photo will be a bigger blurry photo, only cleaner.

<a id="selection"></a>

## Selection: limit the adjustments

*Edit only one area.*

Open Selection in the Inspector. Choose Rectangle or Ellipse and set its position and size with the sliders. The Adjust edits (light, colour, curves, sharpen...) then apply only inside it.

- Feather softens the edge so the change fades in gradually.
- Invert applies the edit to everything except the area.
- Choose "None" to go back to the whole picture.
- For a free shape, use the Lasso tool (L): drag around the area and let go. The shape closes and becomes the selection.

<a id="local"></a>

## Local adjustments

*Graduated and radial filters.*

Local adjustments change light and colour only where a gradient is strong. Use them to darken a bright sky or to lift a face.

- Graduated: fades along a line (for example from the top of the picture down to the middle).
- Radial: strongest in the middle, fading towards the edges. Tick Invert to affect the outside instead.
- Move the start and end points with the sliders. Then set Exposure, Contrast, Highlights, Shadows, Temperature, Tint, Vibrance, Saturation and Blur for that area.
- You can stack up to 8. Use the eye icon to hide one and the bin to delete it.
- Areas you paint with the Brush also appear here.

<a id="layers"></a>

## Layers

*Pictures stacked on top of each other.*

1. Open Layers in the Inspector and press Add layer. Choose another picture. It goes through the same security checks as any file.
2. Select the layer in the list. Set Opacity, Blend, Size, and the X / Y position.
3. Use the arrows to move a layer up or down the stack. The list shows the top layer first.
4. To place it with the mouse, choose the Move tool (M) and drag the selected layer on the picture. Arrow keys nudge it by 1 pixel (10 with Shift).

- Blend modes: Normal, Multiply (darkens, good for shadows), Screen (lightens, good for glows), Overlay and Soft light (add contrast), Darken, Lighten, Difference.
- Fade: make a layer fade out along a line (Linear) or from its centre (Radial) instead of ending sharply.
- You can have up to 16 layers. Layer pictures are saved inside project files.

> **Tip:** Hide a layer with the eye icon to compare with and without it.

<a id="text"></a>

## Text and shapes

*Add words, boxes, circles and lines.*

1. Open "Text & shapes" in the Inspector.
2. Type your text, choose a font, size and colour, then press Add text layer. Or choose a shape, set its size, and press Add shape layer.
3. The new item is a layer. Select it in Layers to move it (X / Y), resize it, fade it or change its blend mode.

> **Tip:** To change the text later, delete the layer and add it again. A text layer is a picture of the text, so it keeps the same look on every computer.

<a id="save"></a>

## Saving and exporting

*Pictures, icon sets, projects, batches.*

- Export: PNG, JPEG, WebP, AVIF or TIFF. Pick 8 or 16 bit and sRGB or Display P3 colour. You can set the print resolution (DPI) and quality.
- JPEG has no transparency, so transparent areas are filled with a colour you choose.
- Save project writes a .pxe file with your picture, every edit step and your layers. Open it later (or drop it on the window) to carry on exactly where you stopped.
- Presets: app icon sets (iOS, Android, macOS, Windows, favicons, web app), and store and social sizes (App Store, Google Play, Open Graph, X, LinkedIn, Instagram, YouTube, Facebook).
- Batch recipes: save a set of settings once and apply it to many pictures. You get a ZIP with a report of what the security check found in each file.

> **Tip:** A project file is checked like any other file when you open it, including the pictures inside it.

<a id="shortcuts"></a>

## Keyboard shortcuts

*The ones you will use most.*

| Keys | What it does |
| --- | --- |
| Ctrl+O | Open a picture |
| Ctrl+S | Save the project |
| Ctrl+E | Export |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z / Ctrl+Y | Redo |
| Ctrl+K | Command palette |
| F1 | This guide |
| ? | All keyboard shortcuts |
| V  M  L  C  A  E  D  S  B  P  U  R | Select, Move, Lasso, Transform, Adjust, Eraser, Brush, Clone, Retouch, Pixel Art, Upscale, Presets |
| \ (hold) | Show the original |
| Space + drag | Move around the picture |
| Wheel | Zoom |
| Alt (while painting) | Rub paint out (Eraser, Brush) |
| Alt + click (Clone) | Choose the source |

<a id="help"></a>

## Problems and answers

*If something looks wrong.*

- "My picture was not opened": the message says why. Common reasons: the file is too large, its type does not match its name, or it failed a security check.
- "ClamAV is not running": the extra malware scan is skipped. Everything else still runs. This is not an error.
- "The preview looks soft": raise Preview quality in the top bar. Export is always full quality.
- "A tool is greyed out": it needs an open picture.
- "I painted but nothing changed": make sure the Strength is not zero and you are painting on the picture, not the grey area around it.
- "I lost my edits": press Ctrl+Z, or click an earlier step in History. Save a project to keep your steps for later.

What pixels does not do: it has no AI features (no generative fill, no automatic subject detection, no AI upscaling), no RAW camera files, and no CMYK print colour. These are deliberate or not built yet.


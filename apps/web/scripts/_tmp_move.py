def patch(path, pairs):
    s = open(path, encoding='utf-8').read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:60], s.count(a))
        s = s.replace(a, b)
    open(path, 'w', encoding='utf-8').write(s)


patch('src/components/Icon.tsx', [("  clone: [", "  move: ['M12 3v18', 'M3 12h18', 'M9 6l3-3 3 3', 'M9 18l3 3 3-3', 'M6 9l-3 3 3 3', 'M18 9l3 3-3 3'],\n  clone: [")])
patch('src/lib/tools.ts', [("  {\n    id: 'transform',", """  {
    id: 'move',
    label: 'Move',
    icon: 'move',
    shortcut: 'M',
    ready: true,
    description: 'Drag the selected layer on the picture. Arrow keys nudge it.',
  },
  {
    id: 'transform',""")])
patch('src/viewport/Viewport.tsx', [
    ("import { BrushOverlay } from './BrushOverlay'\n", "import { BrushOverlay } from './BrushOverlay'\nimport { MoveOverlay } from './MoveOverlay'\n"),
    ("      {hasImage && <BrushOverlay />}\n", "      {hasImage && <BrushOverlay />}\n      {hasImage && <MoveOverlay />}\n"),
])
patch('src/components/RightPanel.tsx', [("          {image && tool === 'brush' && <BrushPanel />}\n", """          {image && tool === 'brush' && <BrushPanel />}
          {image && tool === 'move' && (
            <div className="tool-panel">
              <div className="tool-panel-head">
                <h4>Move</h4>
              </div>
              <p className="hint">
                Drag on the picture to move the selected layer (hold Shift for a straight line). Arrow keys nudge
                it. Pick the layer first in Layers.
              </p>
            </div>
          )}
""")])
patch('src/help/guide.ts', [
    ("          'Use the arrows to move a layer up or down the stack. The list shows the top layer first.',",
     "          'Use the arrows to move a layer up or down the stack. The list shows the top layer first.',\n          'To place it with the mouse, choose the Move tool (M) and drag the selected layer on the picture. Arrow keys nudge it by 1 pixel (10 with Shift).',"),
    ("['V  C  A  E  D  S  B  P  U  R', 'Select, Transform, Adjust, Eraser, Brush, Clone, Retouch, Pixel Art, Upscale, Presets']",
     "['V  M  C  A  E  D  S  B  P  U  R', 'Select, Move, Transform, Adjust, Eraser, Brush, Clone, Retouch, Pixel Art, Upscale, Presets']"),
])
patch('scripts/e2e-tools.mjs', [("// ---- User guide (F1)", """// ---- Move tool: drag the selected layer ---------------------------------------------------------
await page.locator('.section-head', { hasText: 'Layers' }).first().click()
await page.locator('.layer-name').first().click()
const xBefore = await page.locator('.slider', { hasText: 'X' }).first().locator('input[type="number"]').inputValue()
await pick('Move')
await page.waitForSelector('.move-layer')
const mb = await page.locator('.move-layer').boundingBox()
await page.mouse.move(mb.x + mb.width * 0.5, mb.y + mb.height * 0.5)
await page.mouse.down()
for (let i = 1; i <= 6; i++) await page.mouse.move(mb.x + mb.width * (0.5 + i * 0.04), mb.y + mb.height * 0.5)
await page.mouse.up()
await page.waitForTimeout(400)
const xAfter = await page.locator('.slider', { hasText: 'X' }).first().locator('input[type="number"]').inputValue()
check(xBefore !== xAfter, `dragging with the Move tool moves the layer (X ${xBefore} -> ${xAfter})`)

// ---- User guide (F1)""")])
print('ok')

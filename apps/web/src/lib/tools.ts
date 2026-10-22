import type { IconName } from '../components/Icon'

export interface Tool {
  id: string
  label: string
  icon: IconName
  shortcut: string
  /** False while the tool is still being built: it is shown dimmed with a "Soon" tag. */
  ready: boolean
  description: string
}

export const TOOLS: Tool[] = [
  {
    id: 'select',
    label: 'Select',
    icon: 'select',
    shortcut: 'V',
    ready: true,
    description: 'Move, pan and inspect the image.',
  },
  {
    id: 'move',
    label: 'Move',
    icon: 'move',
    shortcut: 'M',
    ready: true,
    description: 'Drag the selected layer on the picture. Arrow keys nudge it.',
  },
  {
    id: 'lasso',
    label: 'Lasso',
    icon: 'lasso',
    shortcut: 'L',
    ready: true,
    description: 'Draw around an area: the Adjust edits then apply only inside it.',
  },
  {
    id: 'transform',
    label: 'Transform',
    icon: 'transform',
    shortcut: 'C',
    ready: true,
    description: 'Crop, rotate, flip, straighten, perspective, canvas size.',
  },
  {
    id: 'adjust',
    label: 'Adjust',
    icon: 'adjust',
    shortcut: 'A',
    ready: true,
    description: 'Exposure, colour, curves, sharpening and more.',
  },
  {
    id: 'eraser',
    label: 'Eraser',
    icon: 'eraser',
    shortcut: 'E',
    ready: true,
    description: 'Paint over anything to remove it: the gap is filled from the surrounding texture.',
  },
  {
    id: 'brush',
    label: 'Brush',
    icon: 'brush',
    shortcut: 'D',
    ready: true,
    description: 'Paint light and colour onto part of the picture: dodge, burn, brighten eyes, whiten teeth.',
  },
  {
    id: 'clone',
    label: 'Clone',
    icon: 'clone',
    shortcut: 'S',
    ready: true,
    description: 'Copy one part of the picture onto another: remove blemishes, extend textures.',
  },
  {
    id: 'background',
    label: 'Retouch',
    icon: 'background',
    shortcut: 'B',
    ready: true,
    description: 'Heal spots, cut out a plain background, smooth skin.',
  },
  {
    id: 'pixelart',
    label: 'Pixel Art',
    icon: 'pixelart',
    shortcut: 'P',
    ready: true,
    description: 'Palette, dithering and sprite export.',
  },
  {
    id: 'upscale',
    label: 'Upscale',
    icon: 'upscale',
    shortcut: 'U',
    ready: true,
    description: 'Enlarge pictures with high-quality resampling and detail-preserving sharpening.',
  },
  {
    id: 'presets',
    label: 'Presets',
    icon: 'presets',
    shortcut: 'R',
    ready: true,
    description: 'App icons, store sizes, mockups and batch recipes.',
  },
]

export const toolAvailable = (tool: Tool): boolean => tool.ready

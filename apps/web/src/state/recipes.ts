import { create } from 'zustand'
import { defaultExportOptions, type Recipe } from '../api/edit'
import { committedState, displayedState, useEdit } from './edit'

/**
 * Saved recipes ("actions"): a look made of adjustments and any rotation or flip. Apply one to the open
 * picture in one step, or run it on many pictures from Presets > Batch. Kept in this browser only.
 */
const KEY = 'pixels.recipes'

function load(): Recipe[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(saved) ? (saved as Recipe[]).filter((r) => r && typeof r.name === 'string') : []
  } catch {
    return []
  }
}

interface RecipeStore {
  recipes: Recipe[]
  save: (recipe: Recipe) => void
  remove: (name: string) => void
}

export const useRecipes = create<RecipeStore>((set, get) => {
  const store = (recipes: Recipe[]) => {
    set({ recipes })
    try {
      localStorage.setItem(KEY, JSON.stringify(recipes))
    } catch {
      /* storage unavailable: kept for this session */
    }
  }
  return {
    recipes: load(),
    save: (recipe) => store([...get().recipes.filter((r) => r.name !== recipe.name), recipe]),
    remove: (name) => store(get().recipes.filter((r) => r.name !== name)),
  }
})

/** The current edits as a recipe: adjustments plus rotations and flips (crops only fit one picture). */
export function recipeFromCurrent(name: string, extra: Partial<Recipe> = {}): Recipe {
  return {
    name: name.trim().slice(0, 80) || 'Action',
    orientation: committedState().geometry.filter(
      (g): g is Extract<typeof g, { type: 'rotate90' | 'flip' }> =>
        g.type === 'rotate90' || g.type === 'flip',
    ),
    layout: { type: 'none' },
    adjust: displayedState().adjust,
    export: { ...defaultExportOptions(), format: 'webp', quality: 90 },
    suffix: '_edited',
    ...extra,
  }
}

/** Apply a recipe to the open picture as one history step: its adjustments replace the current ones,
 * and its rotations and flips are added after the picture's own geometry. */
export function applyRecipe(recipe: Recipe): void {
  const state = committedState()
  useEdit.getState().commit(`Action: ${recipe.name}`, {
    ...state,
    adjust: { ...state.adjust, ...recipe.adjust },
    geometry: [...state.geometry, ...recipe.orientation],
  })
}

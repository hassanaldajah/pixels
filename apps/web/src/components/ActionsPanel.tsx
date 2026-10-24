import { useState } from 'react'
import { useT } from '../i18n'
import { useImage } from '../state/image'
import { applyRecipe, recipeFromCurrent, useRecipes } from '../state/recipes'
import { Icon } from './Icon'

/** Actions: save the current look under a name, then apply it to any picture in one step. */
export function ActionsPanel() {
  const t = useT()
  const image = useImage((s) => s.current)
  const recipes = useRecipes((s) => s.recipes)
  const [name, setName] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  if (!image) return <p className="muted">{t('Open an image to save or apply an action.')}</p>
  const taken = recipes.some((r) => r.name === name.trim())

  return (
    <div className="layers-panel actions-panel">
      <p className="hint">
        {t(
          'An action remembers your adjustments and any rotation or flip. Apply it to another picture in one click, or to many at once in Presets > Batch.',
        )}
      </p>
      <form
        className="actions-save"
        onSubmit={(e) => {
          e.preventDefault()
          const recipe = recipeFromCurrent(name || t('My action'))
          useRecipes.getState().save(recipe)
          setSaved(recipe.name)
          setName('')
        }}
      >
        <input
          type="text"
          className="text-input"
          value={name}
          maxLength={80}
          dir="auto"
          placeholder={t('Name, e.g. Warm portrait')}
          aria-label={t('Action name')}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="button button-primary">
          {taken ? t('Replace') : t('Save action')}
        </button>
      </form>
      {saved && (
        <p className="hint" role="status">
          <Icon name="check" size={13} /> {t('Saved “{name}”.', { name: saved })}
        </p>
      )}
      {recipes.length === 0 ? (
        <p className="muted">{t('No actions yet. Edit a picture, then save the look here.')}</p>
      ) : (
        <ul className="action-list">
          {recipes.map((r) => (
            <li key={r.name}>
              <span className="action-name" title={r.name} dir="auto">
                {r.name}
              </span>
              <button
                type="button"
                className="button"
                onClick={() => applyRecipe(r)}
                title={t('Apply to this picture (one undo step)')}
              >
                {t('Apply')}
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={t('Delete {name}', { name: r.name })}
                title={t('Delete')}
                onClick={() => useRecipes.getState().remove(r.name)}
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

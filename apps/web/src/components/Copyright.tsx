import { useT } from '../i18n'

/** Always visible at the bottom of the window. */
export function Copyright() {
  const t = useT()
  return (
    <footer className="copyright">
      <span>
        © {new Date().getFullYear()} Hassan Aldajah. {t('All rights reserved.')}
      </span>
    </footer>
  )
}

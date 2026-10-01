import { useEffect } from 'react'
import { useUi } from '../stores/ui'
import { t } from '../i18n/strings.vi'

/* Foundation only: Ctrl+K opens an empty command list wired to real routes later. */
export function CommandPalette() {
  const { paletteOpen, setPalette } = useUi()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette(!useUi.getState().paletteOpen)
      }
      if (e.key === 'Escape') setPalette(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPalette])

  if (!paletteOpen) return null
  return (
    <div role="dialog" aria-label={t('palette.title')} className="fixed inset-0 z-40 bg-black/60 p-8" onClick={() => setPalette(false)}>
      <div className="mx-auto max-w-lg rounded border border-border bg-surface p-4" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-semibold text-ink">{t('palette.title')}</p>
        <p className="mt-2 text-xs text-muted">Phase 1: shell foundation. Commands land with features.</p>
      </div>
    </div>
  )
}

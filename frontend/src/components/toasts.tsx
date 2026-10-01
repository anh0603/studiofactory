import { useUi } from '../stores/ui'

export function Toasts() {
  const { toasts, dismissToast } = useUi()
  return (
    <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} className="rounded border border-border bg-surface p-3 shadow">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-ink">{toast.title}</p>
            <button aria-label="Dismiss" onClick={() => dismissToast(toast.id)} className="text-muted">×</button>
          </div>
          {toast.detail ? <p className="mt-1 text-xs text-secondary">{toast.detail}</p> : null}
        </div>
      ))}
    </div>
  )
}

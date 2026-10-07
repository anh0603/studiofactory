import { useUi } from '../stores/ui'

export function Toasts() {
  const { toasts, dismissToast } = useUi()
  const tint: Record<string, string> = {
    success: 'border-emerald-900/70', warning: 'border-amber-900/70',
    error: 'border-red-900/70', info: 'border-border',
  }
  const dot: Record<string, string> = {
    success: 'bg-emerald-400', warning: 'bg-amber-400', error: 'bg-red-400', info: 'bg-accent',
  }
  return (
    <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex w-[320px] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`animate-toast-in rounded-xl border bg-[#141A21]/95 p-3 shadow-xl backdrop-blur ${tint[toast.kind] ?? tint.info}`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot[toast.kind] ?? dot.info}`} />
              {toast.title}
            </p>
            <button
              aria-label="Đóng thông báo"
              onClick={() => dismissToast(toast.id)}
              className="-mr-1 -mt-0.5 rounded px-1 text-secondary transition-colors duration-micro hover:text-ink"
            >
              ×
            </button>
          </div>
          {toast.detail ? <p className="mt-1 pl-3.5 text-xs leading-relaxed text-secondary">{toast.detail}</p> : null}
        </div>
      ))}
    </div>
  )
}

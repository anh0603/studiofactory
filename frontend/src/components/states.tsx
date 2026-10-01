import { t } from '../i18n/strings.vi'

export function LoadingState({ label }: { label?: string }) {
  return <div role="status" className="text-secondary">{label ?? t('state.loading')}</div>
}

export function EmptyState({ title, action }: { title?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-surface p-6 text-center">
      <p className="text-ink">{title ?? t('state.empty')}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

export function ErrorState({ message, onRetry, requestId }: { message: string; onRetry?: () => void; requestId?: string }) {
  return (
    <div role="alert" className="rounded border border-border bg-surface p-6">
      <p className="font-semibold text-ink">{t('state.error')}</p>
      <p className="mt-1 text-secondary">{message}</p>
      {requestId ? <p className="mt-1 text-xs text-muted">request_id: {requestId}</p> : null}
      {onRetry ? (
        <button onClick={onRetry} className="mt-3 rounded bg-accent px-3 py-1.5 text-sm font-semibold text-black">
          {t('action.retry')}
        </button>
      ) : null}
    </div>
  )
}

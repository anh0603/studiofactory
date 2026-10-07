import { t } from '../i18n/strings.vi'
import { Btn, SkeletonList, Spinner } from './ui'

export function LoadingState({ label }: { label?: string }) {
  return <Spinner label={label ?? t('state.loading')} />
}

/** Preferred for page-level loads: no spinner, no layout jump. */
export function LoadingList({ rows }: { rows?: number }) {
  return <SkeletonList rows={rows} />
}

export function EmptyState({ title, hint, action, icon }: { title?: string; hint?: string; action?: React.ReactNode; icon?: string }) {
  return (
    <div className="animate-fade-rise rounded-xl border border-dashed border-border bg-[#10141A] px-6 py-10 text-center">
      <div className="empty-icon">{icon ?? '○'}</div>
      <p className="text-sm font-medium text-secondary">{title ?? t('state.empty')}</p>
      {hint ? <p className="mx-auto mt-1 max-w-md text-[12px] text-muted">{hint}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}

export function ErrorState({ message, onRetry, requestId }: { message: string; onRetry?: () => void; requestId?: string }) {
  return (
    <div role="alert" className="animate-fade-rise rounded-xl border border-red-900/60 bg-red-950/20 p-5">
      <p className="text-sm font-semibold text-red-300">{t('state.error')}</p>
      <p className="mt-1 text-[13px] text-secondary">{message}</p>
      {requestId ? <p className="mono mt-2 text-muted">request_id: {requestId}</p> : null}
      {onRetry ? (
        <Btn variant="ghost" size="sm" onClick={onRetry} className="mt-3">
          {t('action.retry')}
        </Btn>
      ) : null}
    </div>
  )
}
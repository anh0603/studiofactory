/**
 * Error presentation: WHAT HAPPENED / WHY / WHAT TO DO.
 * The request id stays out of the main reading surface — it lives in a
 * collapsible so users are not confronted with an identifier they cannot act on,
 * but it stays available for support.
 */
export function ExplainError({
  what, error, todo, onRetry, retryLabel = 'Thử lại',
}: {
  what: string
  error: unknown
  todo: string
  onRetry?: () => void
  retryLabel?: string
}) {
  const e = (error ?? {}) as Error & { code?: string; requestId?: string }
  const code = e.code ?? ''
  const requestId = e.requestId ?? ''

  return (
    <div role="alert" className="animate-fade-rise rounded-xl border border-red-900/60 bg-red-950/20 p-4">
      <div className="space-y-1.5 text-[13px]">
        <p>
          <span className="font-semibold text-secondary">Đã xảy ra: </span>
          <span className="text-red-200">{what}</span>
        </p>
        <p>
          <span className="font-semibold text-secondary">Nguyên nhân: </span>
          <span className="text-ink">{e.message || 'Không rõ nguyên nhân'}</span>
        </p>
        <p>
          <span className="font-semibold text-secondary">Cách xử lý: </span>
          <span className="text-ink">{todo}</span>
        </p>
      </div>
      {code || requestId ? (
        <details className="mt-2.5 border-t border-red-900/40 pt-2">
          <summary className="cursor-pointer text-[12px] font-medium text-secondary hover:text-ink">
            Chi tiết kỹ thuật
          </summary>
          <dl className="mono mt-1.5 space-y-0.5 text-[11px] text-muted">
            {code ? <div><dt>Mã lỗi: {code}</dt></div> : null}
            {requestId ? <div><dt>Mã yêu cầu: {requestId}</dt></div> : null}
          </dl>
        </details>
      ) : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="btn btn-ghost mt-3 px-2.5 py-1 text-[13px]">
          {retryLabel}
        </button>
      ) : null}
    </div>
  )
}
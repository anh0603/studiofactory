import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { EmptyState, ErrorState, LoadingState } from '../components/states'
import { t } from '../i18n/strings.vi'

export function DashboardPage() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: 1 })
  const diag = useQuery({ queryKey: ['diagnostics'], queryFn: api.diagnostics, retry: 1 })

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t('app.title')}</h1>
      <p className="text-secondary">{t('dashboard.hero')}</p>

      {health.isPending ? <LoadingState /> : null}
      {health.isError ? (
        <ErrorState
          message={(health.error as Error).message}
          requestId={(health.error as { requestId?: string }).requestId}
          onRetry={() => health.refetch()}
        />
      ) : null}
      {health.data ? (
        <div className="rounded border border-border bg-surface p-4 text-sm">
          <p>Backend: <span className="text-ink">{health.data.status}</span></p>
          <p className="text-xs text-muted">request_id: {health.data.request_id}</p>
        </div>
      ) : null}

      <h2 className="text-sm font-semibold">{t('dashboard.health')}</h2>
      {diag.isPending ? <LoadingState /> : null}
      {diag.isError ? <ErrorState message={(diag.error as Error).message} onRetry={() => diag.refetch()} /> : null}
      {diag.data ? (
        <ul className="grid gap-2 md:grid-cols-2">
          {Object.entries(diag.data.checks).map(([key, value]) => (
            <li key={key} className="rounded border border-border bg-surface p-3 text-sm">
              <span className="font-semibold">{key}</span>
              <span className="ml-2 text-secondary">{value.status}</span>
              {value.detail ? <p className="text-xs text-muted">{value.detail}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <EmptyState title="Story / Affiliate workspaces land in later phases." />
    </div>
  )
}

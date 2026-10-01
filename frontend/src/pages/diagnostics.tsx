import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { ErrorState, LoadingState } from '../components/states'

export function DiagnosticsPage() {
  const q = useQuery({ queryKey: ['diagnostics'], queryFn: api.diagnostics, refetchInterval: 10000 })
  if (q.isPending) return <LoadingState />
  if (q.isError)
    return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
  const checks = q.data.checks as Record<string, { status: string; detail?: string }>
  const requestId = (q.data as { request_id?: string }).request_id ?? ''
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Diagnostics</h1>
      <p className="text-xs text-muted">Kết quả kiểm tra thật từ backend (request {requestId}).</p>
      <ul className="grid gap-2 md:grid-cols-2">
        {Object.entries(checks).map(([key, value]) => (
          <li key={key} className="rounded border border-border bg-surface p-3 text-sm">
            <span className="font-semibold">{key}</span>
            <span className="ml-2">{value.status}</span>
            {value.detail ? <p className="text-xs text-muted">{value.detail}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

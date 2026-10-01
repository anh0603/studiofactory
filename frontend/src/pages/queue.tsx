import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { EmptyState, ErrorState, LoadingState } from '../components/states'

const FILTERS = ['ALL', 'QUEUED', 'RUNNING', 'PAUSED', 'SUCCEEDED', 'FAILED', 'CANCELLED']

export function QueuePage() {
  const [filter, setFilter] = useState('ALL')
  const jobs = useQuery({
    queryKey: ['jobs', filter],
    queryFn: () => api.jobs(filter === 'ALL' ? undefined : filter),
    refetchInterval: 3000,
  })

  if (jobs.isPending) return <LoadingState />
  if (jobs.isError)
    return <ErrorState message={(jobs.error as Error).message} onRetry={() => jobs.refetch()} />

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Production Queue</h1>
      <div className="flex flex-wrap gap-2 text-xs">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded border px-2 py-1 ${filter === f ? 'border-accent text-ink' : 'border-border text-muted'}`}
          >
            {f}
          </button>
        ))}
      </div>
      {jobs.data.data.length === 0 ? (
        <EmptyState title="Hàng đợi trống. Job được tạo từ project có Director Plan đã duyệt." />
      ) : (
        <ul className="space-y-2">
          {jobs.data.data.map((j) => (
            <li key={j.id} className="rounded border border-border bg-surface p-3 text-sm">
              <Link to={`/queue/${j.id}`} className="font-semibold text-ink hover:text-accent">
                {j.id}
              </Link>
              <p className="text-xs text-secondary">
                {j.status} · {j.stage}
                {j.progress_percent != null ? ` · ${j.progress_percent}%` : ''} · {j.status_text}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

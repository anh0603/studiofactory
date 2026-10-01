import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { ErrorState, LoadingState } from '../components/states'

export function JobDetailPage() {
  const { jobId } = useParams()
  const qc = useQueryClient()
  const [msg, setMsg] = useState('')
  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.job(jobId!),
    refetchInterval: 3000,
  })

  const act = async (a: 'pause' | 'resume' | 'cancel' | 'retry') => {
    try {
      await api.jobAction(jobId!, a)
      setMsg('')
    } catch (e) {
      const err = e as Error & { code?: string }
      setMsg(`${err.code ?? 'ERROR'}: ${err.message}`)
    }
    qc.invalidateQueries({ queryKey: ['job', jobId] })
  }

  if (job.isPending) return <LoadingState />
  if (job.isError)
    return <ErrorState message={(job.error as Error).message} onRetry={() => job.refetch()} />

  const d = job.data.data
  return (
    <div className="space-y-4">
      <Link to="/queue" className="text-xs text-accent">
        ← Production Queue
      </Link>
      <h1 className="text-xl font-bold">{d.id}</h1>
      <p className="text-sm text-secondary">
        {d.status} · {d.stage} · {d.status_text}
      </p>
      <div className="flex flex-wrap gap-3 text-xs">
        <button className="text-accent" onClick={() => act('pause')}>
          Pause
        </button>
        <button className="text-accent" onClick={() => act('resume')}>
          Resume
        </button>
        <button className="text-accent" onClick={() => act('cancel')}>
          Cancel
        </button>
        <button className="text-accent" onClick={() => act('retry')}>
          Retry
        </button>
      </div>
      {msg ? <p className="text-xs text-accent">{msg}</p> : null}
      <h2 className="text-sm font-semibold">Nodes ({d.nodes.length})</h2>
      <ul className="space-y-1 text-sm">
        {d.nodes.map((n) => (
          <li key={n.id} className="rounded border border-border bg-surface p-2">
            {n.type} — {n.status}
            {n.attempts > 1 ? ` · thử ${n.attempts} lần` : ''}
            {n.provider ? ` · ${n.provider}/${n.model}` : ''}
            {n.error_code ? ` · ${n.error_code}` : ''}
          </li>
        ))}
      </ul>
      <h2 className="text-sm font-semibold">Events ({d.events.length})</h2>
      <ul className="space-y-1 text-xs text-secondary">
        {d.events.slice(-20).map((e, i) => (
          <li key={i}>
            {e.event} · {e.status}
            {e.error_category ? ` · ${e.error_category}` : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}

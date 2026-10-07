import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { ErrorState, LoadingList } from '../components/states'
import { Btn, Card, PageHeader, StatusBadge } from '../components/ui'
import { labelVi, statusVi } from '../i18n/strings.vi'

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
    try { await api.jobAction(jobId!, a); setMsg('') }
    catch (e) {
      const err = e as Error & { code?: string }
      setMsg(`${err.code ?? 'ERROR'}: ${err.message}`)
    }
    qc.invalidateQueries({ queryKey: ['job', jobId] })
  }

  if (job.isPending) return <LoadingList rows={4} />
  if (job.isError)
    return <ErrorState message={(job.error as Error).message} onRetry={() => job.refetch()} />

  const d = job.data.data
  const done = d.nodes.filter((n) => n.status === 'SUCCEEDED' || n.status === 'SKIPPED_REUSE').length
  return (
    <div className="space-y-4">
      <PageHeader
        title={d.id}
        sub={`${labelVi(d.kind)} · dự án ${d.project_id.slice(0, 12)}…`}
        actions={<StatusBadge value={d.status} />}
      />
      <Card>
        <div className="flex items-center justify-between text-[13px] text-secondary">
          <span>{labelVi(d.stage)} · {d.status_text || '—'}</span>
          <span className="mono">{done}/{d.nodes.length} bước</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-state ease-out"
            style={{ width: `${d.nodes.length ? Math.round((done / d.nodes.length) * 100) : 0}%` }}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn size="sm" onClick={() => act('pause')}>Tạm dừng</Btn>
          <Btn size="sm" onClick={() => act('resume')}>Tiếp tục</Btn>
          <Btn size="sm" onClick={() => act('cancel')}>Huỷ</Btn>
          <Btn size="sm" variant="accent" onClick={() => act('retry')}>Chạy lại</Btn>
        </div>
        {msg ? <p className="mt-2 text-xs text-red-300">{msg}</p> : null}
      </Card>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <Card>
          <h2 className="section-title mb-2.5">Các bước xử lý</h2>
          <ol className="relative space-y-0 border-l border-border pl-0" style={{ marginLeft: 6 }}>
            {d.nodes.map((n) => (
              <li key={n.id} className="animate-state-swap relative pb-2.5 pl-5 last:pb-0">
                <span
                  className={
                    'absolute -left-[5px] top-1.5 h-2 w-2 rounded-full transition-colors duration-state ' +
                    (n.status === 'SUCCEEDED' || n.status === 'SKIPPED_REUSE'
                      ? 'bg-emerald-400'
                      : n.status === 'FAILED'
                        ? 'bg-red-400'
                        : n.status === 'RUNNING'
                          ? 'animate-dot-pulse bg-accent'
                          : 'bg-muted')
                  }
                />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                  <span className="font-semibold">{labelVi(n.type)}</span>
                  <StatusBadge value={n.status} />
                  {n.attempts > 1 ? <span className="text-xs text-muted">thử {n.attempts} lần</span> : null}
                </div>
                {(n.provider || n.error_code) ? (
                  <p className="mono mt-0.5 text-secondary">{[n.provider, n.model, labelVi(n.error_code ?? '')].filter(Boolean).join(' · ')}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>
        <Card>
          <h2 className="section-title mb-2.5">Nhật ký sự kiện ({d.events.length})</h2>
          <ul className="max-h-96 space-y-1 overflow-y-auto text-xs text-secondary">
            {d.events.slice(-30).map((e, i) => (
              <li key={i} className="flex justify-between gap-2 border-b border-border/50 py-1 last:border-0">
                <span>{labelVi(e.event)}</span>
                <span className="mono shrink-0 text-muted">{statusVi[e.status] ?? e.status}{e.error_category ? ` · ${e.error_category}` : ''}</span>
              </li>
            ))}
          </ul>
          <Link to="/ai/router" className="link-accent mt-2 inline-block text-[13px]">Xem hoạt động AI →</Link>
        </Card>
      </div>
    </div>
  )
}

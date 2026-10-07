import { Progress } from '@heroui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { ErrorState, LoadingList } from '../components/states'
import { Btn, Card, PageHeader, StatusBadge } from '../components/ui'
import { labelVi, statusVi } from '../i18n/strings.vi'

function NodeDot({ status }: { status: string }) {
  if (status === 'SUCCEEDED' || status === 'SKIPPED_REUSE')
    return <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden="true" />
  if (status === 'FAILED')
    return <XCircle className="h-5 w-5 shrink-0 text-red-400" aria-hidden="true" />
  if (status === 'RUNNING')
    return <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent" aria-hidden="true" />
  return <Circle className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
}

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
  const pct = d.nodes.length ? Math.round((done / d.nodes.length) * 100) : 0
  return (
    <div className="space-y-4">
      <PageHeader
        title={d.id}
        sub={`${labelVi(d.kind)} · dự án ${d.project_id.slice(0, 12)}…`}
        actions={<StatusBadge value={d.status} />}
      />
      <Card className="card-lift">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-secondary">
          <span className="font-medium text-ink">{labelVi(d.stage)} · {d.status_text || '—'}</span>
          <span className="mono">{done}/{d.nodes.length} bước</span>
        </div>
        <Progress
          aria-label="Tiến độ tác vụ"
          value={pct}
          color="primary"
          size="md"
          showValueLabel
          className="mt-3"
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn size="sm" onClick={() => act('pause')}>Tạm dừng</Btn>
          <Btn size="sm" onClick={() => act('resume')}>Tiếp tục</Btn>
          <Btn size="sm" onClick={() => act('cancel')}>Huỷ</Btn>
          <Btn size="sm" variant="accent" onClick={() => act('retry')}>Chạy lại</Btn>
        </div>
        {msg ? <p className="mt-2 text-xs text-red-300">{msg}</p> : null}
      </Card>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <Card>
          <h2 className="section-title mb-3">Các bước xử lý</h2>
          <ol className="space-y-1">
            {d.nodes.map((n) => (
              <li
                key={n.id}
                className="animate-state-swap flex items-start gap-3 rounded-xl border border-transparent px-2.5 py-2 transition-colors duration-hover hover:border-border hover:bg-bg"
              >
                <span className="mt-0.5"><NodeDot status={n.status} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                    <span className="font-semibold">{labelVi(n.type)}</span>
                    <StatusBadge value={n.status} />
                    {n.attempts > 1 ? <span className="text-xs text-muted">thử {n.attempts} lần</span> : null}
                  </div>
                  {(n.provider || n.error_code) ? (
                    <p className="mono mt-0.5 truncate text-secondary">{[n.provider, n.model, labelVi(n.error_code ?? '')].filter(Boolean).join(' · ')}</p>
                  ) : null}
                </div>
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

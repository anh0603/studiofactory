import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { EmptyState, ErrorState } from '../components/states'
import { Btn, Card, Field, PageHeader, Select, Spinner, StatusBadge } from '../components/ui'

export function AutopilotPage() {
  const qc = useQueryClient()
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects })
  const [pid, setPid] = useState('')
  const projectId = pid || projects.data?.data[0]?.id || ''

  const config = useQuery({
    queryKey: ['apconfig', projectId],
    queryFn: () => api.apConfig(projectId),
    enabled: !!projectId,
    retry: false,
  })
  const runs = useQuery({
    queryKey: ['apruns', projectId],
    queryFn: () => api.apRuns(projectId),
    enabled: !!projectId,
    refetchInterval: 4000,
  })

  const [topics, setTopics] = useState('mèo dũng cảm, khu rừng bí ẩn')
  const [requireApproval, setRequireApproval] = useState(true)

  const save = useMutation({
    mutationFn: () =>
      api.saveApConfig(projectId, {
        enabled: true, daily_target: 1, window_start: '00:00', window_end: '23:59',
        timezone: 'Asia/Ho_Chi_Minh',
        topics: topics.split(',').map((s) => s.trim()).filter(Boolean),
        require_approval_before_publish: requireApproval,
        platforms: ['youtube'],
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apconfig', projectId] }),
  })
  const start = useMutation({
    mutationFn: () => api.startApRun(projectId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apruns', projectId] }),
  })
  const act = async (runId: string, a: 'pause' | 'resume' | 'stop' | 'approve') => {
    await api.apRunAction(runId, a).catch(() => undefined)
    qc.invalidateQueries({ queryKey: ['apruns', projectId] })
  }

  if (projects.isPending) return <Spinner />
  if (projects.isError)
    return <ErrorState message={(projects.error as Error).message} onRetry={() => projects.refetch()} />
  const active = (runs.data?.data ?? []).find((r) => ['RUNNING', 'PAUSED', 'AWAITING_APPROVAL'].includes(r.status))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tự lái (Auto Pilot)"
        sub="Lập kế hoạch → Tạo nội dung → Kiểm tra chất lượng → Cổng duyệt → Lên lịch"
        actions={active ? <StatusBadge value={active.status} /> : <span className="badge badge-info">Nhàn rỗi</span>}
      />
      {projects.data.data.length === 0 ? (
        <EmptyState icon="✦" title="Chưa có dự án story. Tạo dự án trước khi bật tự lái." />
      ) : (
      <>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-secondary">Dự án:</span>
        <Select aria-label="Dự án" value={projectId} onChange={(e) => setPid(e.target.value)} className="max-w-64 text-[13px]">
          {projects.data.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>

      <div className="grid gap-3 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <h2 className="section-title mb-1">Cấu hình</h2>
          {config.data ? (
            <div className="mb-3 space-y-1 text-[13px] text-secondary">
              <p>Mục tiêu mỗi ngày: <span className="font-semibold text-ink">{config.data.data.daily_target}</span></p>
              <p>Duyệt trước khi đăng: <span className="font-semibold text-ink">{config.data.data.require_approval_before_publish ? 'Có' : 'Không'}</span></p>
              <p>Chủ đề: <span className="text-ink">{config.data.data.topics.join(', ') || '—'}</span></p>
            </div>
          ) : (
            <p className="mb-3 text-xs text-muted">Chưa cấu hình — lưu form bên dưới để bật.</p>
          )}
          <div className="space-y-2">
            <Field aria-label="Chủ đề" value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="chủ đề, cách nhau bởi dấu phẩy" />
            <label className="flex items-center gap-2 text-[13px] text-secondary">
              <input type="checkbox" checked={requireApproval} onChange={(e) => setRequireApproval(e.target.checked)} className="h-4 w-4 accent-accent" />
              Duyệt trước khi đăng
            </label>
            <div className="flex gap-2">
              <Btn variant="accent" busy={save.isPending} disabled={save.isPending} onClick={() => save.mutate()} className="flex-1">Lưu & bật</Btn>
              <Btn disabled={!config.data} onClick={() => start.mutate()} className="flex-1">Chạy ngay</Btn>
            </div>
          </div>
          {start.isError ? (
            <p className="mt-2 rounded-lg bg-red-950/30 px-2.5 py-2 text-xs text-red-300">
              Không chạy được: {(start.error as Error).message}
            </p>
          ) : null}
        </Card>

        <div className="space-y-2.5 lg:col-span-3">
          <h2 className="section-title">Lượt chạy ({(runs.data?.data ?? []).length})</h2>
          {(runs.data?.data.length ?? 0) === 0 ? <EmptyState icon="▶" title="Chưa có lượt chạy nào." /> : null}
          {(runs.data?.data ?? []).map((r) => (
            <Card key={r.id} className="animate-state-swap !p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="mono">{r.id}</span>
                <StatusBadge value={r.status} className="shrink-0" />
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg">
                <div className="h-full rounded-full bg-accent transition-[width] duration-state ease-out" style={{ width: `${r.planned ? Math.round((r.completed / r.planned) * 100) : 0}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-secondary">
                Kế hoạch {r.planned} · Xong {r.completed} · Lỗi {r.failed}
                {r.note ? ` · ${r.note}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Btn size="sm" onClick={() => act(r.id, 'pause')}>Tạm dừng</Btn>
                <Btn size="sm" onClick={() => act(r.id, 'resume')}>Tiếp tục</Btn>
                <Btn size="sm" onClick={() => act(r.id, 'stop')}>Dừng</Btn>
                {r.status === 'AWAITING_APPROVAL' ? (
                  <Btn size="sm" variant="accent" onClick={() => act(r.id, 'approve')}>Duyệt đăng</Btn>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      </div>
      <Link to="/scheduler" className="link-accent text-[13px]">Mở Lịch đăng →</Link>
      </>
      )}
    </div>
  )
}

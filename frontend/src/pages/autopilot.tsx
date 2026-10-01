import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { EmptyState, ErrorState, LoadingState } from '../components/states'

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
        enabled: true,
        daily_target: 1,
        window_start: '00:00',
        window_end: '23:59',
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

  if (projects.isPending) return <LoadingState />
  if (projects.isError)
    return <ErrorState message={(projects.error as Error).message} onRetry={() => projects.refetch()} />
  if (projects.data.data.length === 0) return <EmptyState title="Chưa có project story." />

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Auto Pilot</h1>
      <select
        aria-label="Project"
        value={projectId}
        onChange={(e) => setPid(e.target.value)}
        className="rounded border border-border bg-bg px-2 py-1.5 text-sm"
      >
        {projects.data.data.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <section className="space-y-2 rounded border border-border bg-surface p-3 text-sm">
        <h2 className="font-semibold">Cấu hình</h2>
        {config.data ? (
          <p className="text-xs text-secondary">
            Bật: {String(config.data.data.enabled)} · Mục tiêu/ngày: {config.data.data.daily_target} ·
            Approval trước publish: {String(config.data.data.require_approval_before_publish)}
          </p>
        ) : (
          <p className="text-xs text-muted">Chưa cấu hình — lưu form bên dưới để bật.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="Topics"
            value={topics}
            onChange={(e) => setTopics(e.target.value)}
            placeholder="topics, cách nhau bởi dấu phẩy"
            className="min-w-52 flex-1 rounded border border-border bg-bg px-2 py-1.5 text-sm"
          />
          <label className="flex items-center gap-1 text-xs text-secondary">
            <input
              type="checkbox"
              checked={requireApproval}
              onChange={(e) => setRequireApproval(e.target.checked)}
            />
            Duyệt trước publish
          </label>
          <button
            disabled={save.isPending}
            onClick={() => save.mutate()}
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
          >
            Lưu & bật
          </button>
          <button
            onClick={() => start.mutate()}
            className="rounded border border-border px-3 py-1.5 text-sm"
          >
            Chạy ngay
          </button>
        </div>
        {start.isError ? (
          <p className="text-xs text-accent">
            Không chạy được: {(start.error as Error).message} — kiểm tra config/model/window.
          </p>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Runs</h2>
        {(runs.data?.data ?? []).map((r) => (
          <div key={r.id} className="rounded border border-border bg-surface p-3 text-sm">
            <p className="font-semibold">
              {r.id} · {r.status}
            </p>
            <p className="text-xs text-secondary">
              Kế hoạch {r.planned} · Xong {r.completed} · Lỗi {r.failed}
              {r.note ? ` · ${r.note}` : ''}
            </p>
            <div className="mt-1 flex gap-3 text-xs">
              <button className="text-accent" onClick={() => act(r.id, 'pause')}>
                Pause
              </button>
              <button className="text-accent" onClick={() => act(r.id, 'resume')}>
                Resume
              </button>
              <button className="text-accent" onClick={() => act(r.id, 'stop')}>
                Stop
              </button>
              {r.status === 'AWAITING_APPROVAL' ? (
                <button className="rounded bg-accent px-2 py-0.5 font-semibold text-black" onClick={() => act(r.id, 'approve')}>
                  Duyệt publish
                </button>
              ) : null}
            </div>
          </div>
        ))}
        {runs.data && runs.data.data.length > 0 ? null : (
          <p className="text-xs text-muted">Chưa có run nào.</p>
        )}
      </section>
      <Link to="/scheduler" className="text-xs text-accent">
        Mở Scheduler →
      </Link>
    </div>
  )
}

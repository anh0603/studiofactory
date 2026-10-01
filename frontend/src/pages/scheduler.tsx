import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { EmptyState, ErrorState, LoadingState } from '../components/states'

export function SchedulerPage() {
  const qc = useQueryClient()
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects })
  const [pid, setPid] = useState('')
  const projectId = pid || projects.data?.data[0]?.id || ''
  const [date, setDate] = useState('2026-10-02')
  const [time, setTime] = useState('20:00')
  const [msg, setMsg] = useState('')

  const schedules = useQuery({
    queryKey: ['schedules', projectId],
    queryFn: () => api.schedules(projectId),
    enabled: !!projectId,
    refetchInterval: 4000,
  })

  const create = useMutation({
    mutationFn: () =>
      api.createSchedule(projectId, {
        date,
        time,
        timezone: 'Asia/Ho_Chi_Minh',
        platforms: ['youtube'],
        idempotency_key: `ui-${projectId}-${date}-${time}`,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules', projectId] }),
    onError: (e) => setMsg((e as Error).message),
  })
  const tick = async () => {
    const res = await api.schedulerTick()
    setMsg(`Tick: ${res.data.processed.map((p) => `${p.id.slice(0, 8)}→${p.status}`).join(', ') || 'không có slot đến hạn'}`)
    qc.invalidateQueries({ queryKey: ['schedules', projectId] })
  }

  if (projects.isPending) return <LoadingState />
  if (projects.isError)
    return <ErrorState message={(projects.error as Error).message} onRetry={() => projects.refetch()} />
  if (projects.data.data.length === 0) return <EmptyState title="Chưa có project story." />

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Scheduler</h1>
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
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input aria-label="Ngày" type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="rounded border border-border bg-bg px-2 py-1.5" />
        <input aria-label="Giờ" type="time" value={time} onChange={(e) => setTime(e.target.value)}
          className="rounded border border-border bg-bg px-2 py-1.5" />
        <span className="text-xs text-muted">Asia/Ho_Chi_Minh</span>
        <button
          disabled={create.isPending}
          onClick={() => create.mutate()}
          className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
        >
          Lên lịch
        </button>
        <button onClick={tick} className="text-xs text-accent">
          Chạy tick
        </button>
      </div>
      {msg ? <p className="text-xs text-secondary">{msg}</p> : null}
      <ul className="space-y-2">
        {(schedules.data?.data ?? []).map((s) => (
          <li key={s.id} className="rounded border border-border bg-surface p-3 text-sm">
            <p className="font-semibold">
              {s.id.slice(0, 12)} · {s.status}
            </p>
            <p className="text-xs text-secondary">
              {s.run_at} · {(s.platforms ?? []).join(', ') || '—'}
              {s.recurrence ? ` · lặp ${s.recurrence}` : ''} {s.note ? ` · ${s.note}` : ''}
            </p>
            {s.status === 'SCHEDULED' || s.status === 'MISSED' ? (
              <button className="mt-1 text-xs text-muted" onClick={() => api.cancelSchedule(s.id).then(() => qc.invalidateQueries({ queryKey: ['schedules', projectId] }))}>
                Huỷ
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

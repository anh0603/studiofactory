import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { EmptyState, ErrorState } from '../components/states'
import { Btn, Card, Field, PageHeader, Select, Spinner, StatusBadge } from '../components/ui'
import { statusVi } from '../i18n/strings.vi'

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
        date, time, timezone: 'Asia/Ho_Chi_Minh', platforms: ['youtube'],
        idempotency_key: `ui-${projectId}-${date}-${time}`,
      }),
    onSuccess: () => { setMsg(''); qc.invalidateQueries({ queryKey: ['schedules', projectId] }) },
    onError: (e) => setMsg((e as Error).message),
  })
  const tick = async () => {
    const res = await api.schedulerTick()
    setMsg(`Kết quả tick: ${res.data.processed.map((p) => `${p.id.slice(0, 8)} → ${statusVi[p.status] ?? p.status}`).join(', ') || 'không có khung giờ nào đến hạn'}`)
    qc.invalidateQueries({ queryKey: ['schedules', projectId] })
  }

  if (projects.isPending) return <Spinner />
  if (projects.isError)
    return <ErrorState message={(projects.error as Error).message} onRetry={() => projects.refetch()} />
  return (
    <div className="space-y-4">
      <PageHeader
        title="Lịch đăng"
        sub="Múi giờ Asia/Ho_Chi_Minh · các khung giờ đến hạn được xử lý khi chạy tick"
        actions={projects.data.data.length > 0 ? <Btn size="sm" onClick={tick}>Chạy tick</Btn> : undefined}
      />
      {projects.data.data.length === 0 ? (
        <EmptyState icon="✦" title="Chưa có dự án story. Tạo dự án trước khi lên lịch đăng." />
      ) : (
      <>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Dự án" value={projectId} onChange={(e) => setPid(e.target.value)} className="max-w-64 text-[13px]">
          {projects.data.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      <Card>
        <h2 className="section-title mb-2.5">Slot mới</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Field aria-label="Ngày" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Field aria-label="Giờ" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <span className="mono text-muted">Asia/Ho_Chi_Minh</span>
          <Btn variant="accent" busy={create.isPending} disabled={create.isPending} onClick={() => create.mutate()}>Lên lịch</Btn>
        </div>
        {msg ? <p className="mt-2 text-xs text-secondary">{msg}</p> : null}
      </Card>
      {(schedules.data?.data.length ?? 0) === 0 ? <EmptyState icon="◷" title="Chưa có lịch nào." /> : (
        <ul className="space-y-2">
          {(schedules.data?.data ?? []).map((s) => (
            <li key={s.id} className="row-item flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{s.run_at.replace('T', ' ').slice(0, 16)} <span className="font-normal text-muted">· {(s.platforms ?? []).map((x) => statusVi[x] ?? x).join(', ') || '—'}</span></p>
                <p className="mono mt-0.5 text-muted">{s.id.slice(0, 12)}{s.recurrence ? ` · lặp ${s.recurrence}` : ''}{s.note ? ` · ${s.note}` : ''}</p>
              </div>
              <span className="flex items-center gap-2">
                <StatusBadge value={s.status} />
                {(s.status === 'SCHEDULED' || s.status === 'MISSED') ? (
                  <Btn variant="link" onClick={() => api.cancelSchedule(s.id).then(() => qc.invalidateQueries({ queryKey: ['schedules', projectId] }))}>Huỷ</Btn>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      </>
      )}
    </div>
  )
}

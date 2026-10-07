import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { EmptyState, ErrorState } from '../components/states'
import { Btn, Card, Field, PageHeader, Select, Spinner, StatusBadge } from '../components/ui'
import { statusVi } from '../i18n/strings.vi'

export function PublisherPage() {
  const qc = useQueryClient()
  const platforms = useQuery({ queryKey: ['platforms'], queryFn: api.platforms, refetchInterval: 8000 })
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects })
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api.jobs() })
  const [clientId, setClientId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [jobId, setJobId] = useState('')
  const [pubId, setPubId] = useState('')
  const [msg, setMsg] = useState('')

  const pubStatus = useQuery({
    queryKey: ['pub', pubId],
    queryFn: () => api.publishStatus(pubId),
    enabled: !!pubId,
    refetchInterval: 4000,
  })

  const start = async (platform: string) => {
    try {
      const res = await api.oauthStart(platform, clientId)
      if (res.data.authorize_url) window.open(res.data.authorize_url, '_blank', 'noopener')
      else setMsg(`${statusVi[platform] ?? platform}: ${statusVi[res.data.status] ?? res.data.status} — ${res.data.message ?? 'cần OAuth client_id (BYOK)'}`)
    } catch (e) { setMsg((e as Error).message) }
    qc.invalidateQueries({ queryKey: ['platforms'] })
  }

  const publish = useMutation({
    mutationFn: () => api.publishNow({
      job_id: jobId || undefined, platforms: ['youtube'], title: 'Video mới',
      description: '', hashtags: [],
      idempotency_key: `ui-pub-${jobId || projectId}-${Date.now()}`,
    }),
    onSuccess: (res) => { setPubId(res.data.id); setMsg('') },
    onError: (e) => {
      const err = e as Error & { code?: string }
      setMsg(`${err.code ?? 'ERROR'}: ${err.message}`)
    },
  })

  if (platforms.isPending) return <Spinner />
  if (platforms.isError)
    return <ErrorState message={(platforms.error as Error).message} onRetry={() => platforms.refetch()} />

  const okCount = platforms.data.data.filter((p) => p.status === 'CONNECTED').length

  return (
    <div className="space-y-5">
      <PageHeader title="Đăng bài" sub={`${okCount}/3 nền tảng đã kết nối · chỉ trạng thái Đã đăng mới được tính`} />
      <div className="grid items-start gap-3 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <h2 className="section-title mb-1">Kết nối nền tảng (BYOK OAuth)</h2>
          <p className="mb-3 text-xs text-muted">Dán OAuth client_id của bạn để lấy đường dẫn uỷ quyền. Không có client_id thì hệ thống báo đúng trạng thái “cần cấu hình”.</p>
          <Field aria-label="OAuth client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="OAuth client_id…" className="mb-3" />
          <ul className="grid gap-2 sm:grid-cols-3">
            {platforms.data.data.map((p) => (
              <li key={p.platform} className="rounded-xl border border-border bg-bg p-3">
                <p className="text-sm font-bold">{statusVi[p.platform] ?? p.platform}</p>
                <div className="mt-1.5"><StatusBadge value={p.status} /></div>
                <p className="mono mt-1 truncate text-muted">{p.account ?? 'chưa liên kết'}</p>
                <div className="mt-2 flex gap-2.5">
                  <Btn variant="link" onClick={() => start(p.platform)}>Kết nối</Btn>
                  {p.status === 'CONNECTED' ? (
                    <Btn variant="link" onClick={() => api.oauthDisconnect(p.platform).then(() => qc.invalidateQueries({ queryKey: ['platforms'] }))}>Ngắt kết nối</Btn>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {msg ? <p className="mt-2.5 rounded-lg bg-bg px-2.5 py-2 text-xs text-ember">{msg}</p> : null}
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="section-title mb-2.5">Đăng video</h2>
          <div className="space-y-2">
            <Select aria-label="Dự án" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— Dự án —</option>
              {(projects.data?.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select aria-label="Tác vụ" value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">— Tác vụ đã thành công —</option>
              {(jobs.data?.data ?? []).filter((j) => j.status === 'SUCCEEDED').map((j) => <option key={j.id} value={j.id}>{j.id}</option>)}
            </Select>
            <Btn variant="accent" busy={publish.isPending} disabled={!jobId || publish.isPending} onClick={() => publish.mutate()} className="w-full">
              Đăng YouTube
            </Btn>
          </div>
          {publish.isError ? (
            <p className="mt-2 rounded-lg bg-red-950/30 px-2.5 py-2 text-xs text-red-300">
              Bị chặn/thất bại (trạng thái thật): {(publish.error as Error).message}
            </p>
          ) : null}
          {pubStatus.data ? (
            <ul className="mt-2.5 space-y-1.5">
              {pubStatus.data.data.attempts.map((a) => (
                <li key={a.platform} className="rounded-lg border border-border bg-bg p-2.5 text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{statusVi[a.platform] ?? a.platform}</span>
                    <StatusBadge value={a.status} />
                  </div>
                  <p className="mono mt-1 text-muted">
                    {a.platform_post_id ? `post ${a.platform_post_id}` : 'chưa có post id — chưa đăng'}
                  </p>
                  {a.reason ? <p className="mt-0.5 text-xs text-secondary">{a.reason}</p> : null}
                  {a.status === 'RETRYABLE_ERROR' ? (
                    <Btn variant="link" onClick={() => api.publishRetry(pubStatus.data.data.id).then(() => qc.invalidateQueries({ queryKey: ['pub', pubId] }))} className="mt-1">
                      Thử lại
                    </Btn>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : pubId ? <Spinner label="Đang lấy trạng thái publish…" /> : null}
        </Card>
      </div>
    </div>
  )
}

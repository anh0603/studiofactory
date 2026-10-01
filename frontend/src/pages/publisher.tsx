import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { EmptyState, ErrorState, LoadingState } from '../components/states'

export function PublisherPage() {
  const qc = useQueryClient()
  const platforms = useQuery({ queryKey: ['platforms'], queryFn: api.platforms, refetchInterval: 5000 })
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
      else setMsg(`${platform}: ${res.data.status} — ${res.data.message ?? 'cần OAuth client_id (BYOK)'}`)
    } catch (e) {
      setMsg((e as Error).message)
    }
    qc.invalidateQueries({ queryKey: ['platforms'] })
  }

  const publish = useMutation({
    mutationFn: () =>
      api.publishNow({
        job_id: jobId || undefined,
        platforms: ['youtube'],
        title: 'Video mới',
        description: '',
        hashtags: [],
        idempotency_key: `ui-pub-${jobId || projectId}-${Date.now()}`,
      }),
    onSuccess: (res) => {
      setPubId(res.data.id)
      setMsg('')
    },
    onError: (e) => {
      const err = e as Error & { code?: string }
      setMsg(`${err.code ?? 'ERROR'}: ${err.message}`)
    },
  })

  if (platforms.isPending) return <LoadingState />
  if (platforms.isError)
    return <ErrorState message={(platforms.error as Error).message} onRetry={() => platforms.refetch()} />

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Publisher</h1>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Kết nối nền tảng</h2>
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="OAuth client ID"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="OAuth client_id (BYOK, để trống = xem trạng thái)"
            className="min-w-64 flex-1 rounded border border-border bg-bg px-2 py-1.5 text-sm"
          />
        </div>
        <ul className="grid gap-2 md:grid-cols-3">
          {platforms.data.data.map((p) => (
            <li key={p.platform} className="rounded border border-border bg-surface p-3 text-sm">
              <p className="font-semibold">{p.platform}</p>
              <p className="text-xs text-secondary">
                {p.status} · {p.account ?? 'chưa liên kết'}
              </p>
              <div className="mt-2 flex gap-3 text-xs">
                <button className="text-accent" onClick={() => start(p.platform)}>
                  Kết nối
                </button>
                {p.status === 'CONNECTED' ? (
                  <button
                    className="text-muted"
                    onClick={() =>
                      api.oauthDisconnect(p.platform).then(() => qc.invalidateQueries({ queryKey: ['platforms'] }))
                    }
                  >
                    Ngắt
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {msg ? <p className="text-xs text-accent">{msg}</p> : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Đăng video</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          <select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}
            className="rounded border border-border bg-bg px-2 py-1.5">
            <option value="">— Project —</option>
            {(projects.data?.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select aria-label="Job" value={jobId} onChange={(e) => setJobId(e.target.value)}
            className="rounded border border-border bg-bg px-2 py-1.5">
            <option value="">— Job đã xong —</option>
            {(jobs.data?.data ?? []).filter((j) => j.status === 'SUCCEEDED').map((j) => (
              <option key={j.id} value={j.id}>{j.id}</option>
            ))}
          </select>
          <button
            disabled={!jobId || publish.isPending}
            onClick={() => publish.mutate()}
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
          >
            Đăng YouTube
          </button>
        </div>
        {publish.isError ? (
          <p className="text-xs text-accent">
            Publish bị chặn/thất bại (trạng thái thật từ server): {(publish.error as Error).message}
          </p>
        ) : null}
        {pubStatus.data ? (
          <ul className="space-y-1 text-sm">
            {pubStatus.data.data.attempts.map((a) => (
              <li key={a.platform} className="rounded border border-border bg-surface p-2">
                {a.platform} — {a.status}
                {a.platform_post_id ? ` · post ${a.platform_post_id}` : ' · chưa có post id'}
                {a.reason ? ` · ${a.reason}` : ''}
                {a.status === 'RETRYABLE_ERROR' ? (
                  <button
                    className="ml-2 text-xs text-accent"
                    onClick={() => api.publishRetry(pubStatus.data.data.id).then(() => qc.invalidateQueries({ queryKey: ['pub', pubId] }))}
                  >
                    Thử lại
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : pubId ? (
          <EmptyState title="Đang lấy trạng thái publish..." />
        ) : null}
      </section>
    </div>
  )
}

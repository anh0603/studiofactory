import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { EmptyState, ErrorState, LoadingState } from '../components/states'

const STYLES = ['REVIEW', 'UGC', 'PROBLEM_SOLUTION', 'SHOWCASE', 'COMPARISON', 'STORYTELLING', 'TOP_PRODUCT']

export function AffiliatePage() {
  const qc = useQueryClient()
  const products = useQuery({ queryKey: ['afproducts'], queryFn: api.afProducts })
  const [sel, setSel] = useState('')
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [url, setUrl] = useState('')
  const [style, setStyle] = useState('REVIEW')
  const [msg, setMsg] = useState('')

  const scripts = useQuery({ queryKey: ['afscripts', sel], queryFn: () => api.afScripts(sel), enabled: !!sel })
  const videos = useQuery({ queryKey: ['afvideos', sel], queryFn: () => api.afVideos(sel), enabled: !!sel })

  const create = useMutation({
    mutationFn: () => api.afCreateProduct({ name, description: desc, affiliate_url: url }),
    onSuccess: () => {
      setName('')
      setDesc('')
      setUrl('')
      qc.invalidateQueries({ queryKey: ['afproducts'] })
    },
    onError: (e) => setMsg((e as Error).message),
  })
  const analyze = useMutation({
    mutationFn: () => api.afAnalyze(sel),
    onSuccess: (res) => setMsg(`Phân tích: ${JSON.stringify(res.data.analysis).slice(0, 200)}...`),
    onError: (e) => setMsg((e as Error).message),
  })
  const genScript = useMutation({
    mutationFn: () => api.afCreateScript(sel, style),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['afscripts', sel] }),
    onError: (e) => setMsg((e as Error).message),
  })
  const genVideo = async (scriptId: string) => {
    try {
      await api.afCreateVideo(sel, scriptId, false)
      setMsg('')
    } catch (e) {
      setMsg((e as Error).message)
    }
    qc.invalidateQueries({ queryKey: ['afvideos', sel] })
  }
  const doExport = async (videoId: string) => {
    try {
      const res = await api.afExportVideo(videoId)
      setMsg(`Đã export: ${res.data.manifest.file}`)
    } catch (e) {
      setMsg((e as Error).message)
    }
    qc.invalidateQueries({ queryKey: ['afvideos', sel] })
  }

  if (products.isPending) return <LoadingState />
  if (products.isError)
    return <ErrorState message={(products.error as Error).message} onRetry={() => products.refetch()} />

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Affiliate Factory</h1>
      <p className="text-xs text-muted">Workflow độc lập: Product → Script → Video → Preview → Export. Không auto publish.</p>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Sản phẩm ({products.data.data.length})</h2>
        {products.data.data.length === 0 ? (
          <EmptyState title="Chưa có sản phẩm. Thêm sản phẩm đầu tiên." />
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {products.data.data.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => setSel(p.id)}
                  className={`w-full rounded border p-3 text-left text-sm ${sel === p.id ? 'border-accent bg-surface' : 'border-border bg-surface'}`}
                >
                  <span className="font-semibold">{p.name}</span>
                  <span className="block text-xs text-secondary">{p.price} · {p.videos} videos</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <input aria-label="Tên sản phẩm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên sản phẩm"
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm" />
          <input aria-label="Mô tả" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Mô tả"
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm" />
          <input aria-label="Affiliate URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..."
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm" />
          <button disabled={!name || create.isPending} onClick={() => create.mutate()}
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50">
            Thêm sản phẩm
          </button>
        </div>
      </section>

      {sel ? (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <button className="rounded border border-border px-2 py-1" onClick={() => analyze.mutate()}>
              Phân tích AI
            </button>
            <select aria-label="Kiểu script" value={style} onChange={(e) => setStyle(e.target.value)}
              className="rounded border border-border bg-bg px-2 py-1">
              {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="rounded bg-accent px-2 py-1 font-semibold text-black" onClick={() => genScript.mutate()}>
              Tạo script
            </button>
          </div>
          {msg ? <p className="text-xs text-secondary">{msg}</p> : null}
          <h3 className="text-sm font-semibold">Scripts ({scripts.data?.data.length ?? 0})</h3>
          {(scripts.data?.data ?? []).map((s) => (
            <div key={s.id} className="rounded border border-border bg-surface p-3 text-sm">
              <p className="text-xs text-muted">{s.style}{s.disclosure_injected ? ' · disclosure tự động' : ''}</p>
              <p className="font-semibold">{s.hook}</p>
              <p className="mt-1">{s.body}</p>
              <p className="mt-1 text-accent">{s.cta}</p>
              <p className="mt-1 text-xs text-secondary">{s.disclosure}</p>
              <button className="mt-2 text-xs text-accent" onClick={() => genVideo(s.id)}>
                Tạo video từ script này
              </button>
            </div>
          ))}
          <h3 className="text-sm font-semibold">Videos ({videos.data?.data.length ?? 0})</h3>
          {(videos.data?.data ?? []).map((v) => (
            <div key={v.id} className="flex items-center justify-between rounded border border-border bg-surface p-2 text-sm">
              <span>{v.id.slice(0, 12)} · {v.status}</span>
              <button className="text-xs text-accent" onClick={() => doExport(v.id)}>
                Export
              </button>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  )
}

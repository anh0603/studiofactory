import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { EmptyState } from '../components/states'
import { Btn, Card, Field, PageHeader, Select, StatusBadge } from '../components/ui'

const STYLES: Record<string, string> = {
  REVIEW: 'Đánh giá', UGC: 'Người dùng thật', PROBLEM_SOLUTION: 'Vấn đề và giải pháp',
  SHOWCASE: 'Trình diễn sản phẩm', COMPARISON: 'So sánh', STORYTELLING: 'Kể chuyện',
  TOP_PRODUCT: 'Sản phẩm nổi bật',
}

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
    onSuccess: () => { setName(''); setDesc(''); setUrl(''); setMsg(''); qc.invalidateQueries({ queryKey: ['afproducts'] }) },
    onError: (e) => setMsg((e as Error).message),
  })
  const analyze = useMutation({
    mutationFn: () => api.afAnalyze(sel),
    onSuccess: (res) => setMsg(`Kết quả phân tích: ${JSON.stringify(res.data.analysis).slice(0, 220)}…`),
    onError: (e) => setMsg((e as Error).message),
  })
  const genScript = useMutation({
    mutationFn: () => api.afCreateScript(sel, style),
    onSuccess: () => { setMsg(''); qc.invalidateQueries({ queryKey: ['afscripts', sel] }) },
    onError: (e) => setMsg((e as Error).message),
  })
  const genVideo = async (scriptId: string) => {
    try { await api.afCreateVideo(sel, scriptId, false); setMsg('') }
    catch (e) { setMsg((e as Error).message) }
    qc.invalidateQueries({ queryKey: ['afvideos', sel] })
  }
  const doExport = async (videoId: string) => {
    try {
      const res = await api.afExportVideo(videoId)
      setMsg(`Đã xuất tệp: ${res.data.manifest.file}`)
    } catch (e) { setMsg((e as Error).message) }
    qc.invalidateQueries({ queryKey: ['afvideos', sel] })
  }

  const selected = products.data?.data.find((p) => p.id === sel)

  return (
    <div className="space-y-5">
      <PageHeader title="Affiliate Factory" sub="Sản phẩm → Kịch bản → Video → Xem trước → Xuất tệp · không tự đăng" />
      <div className="grid items-start gap-3 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-2">
          <Card>
            <h2 className="section-title mb-2.5">Sản phẩm ({products.data?.data.length ?? '…'})</h2>
            {(products.data?.data.length ?? 0) === 0 ? <EmptyState icon="◍" title="Chưa có sản phẩm nào." /> : (
              <ul className="space-y-1.5">
                {products.data!.data.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => { setSel(p.id); setMsg('') }}
                      className={`row-item row-item-hover flex w-full items-center justify-between gap-2 !p-3 text-left ${sel === p.id ? '!border-[#F2793C]/45 bg-[#1F1813]' : ''}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{p.name}</span>
                        <span className="mono text-muted">{p.price} · {p.videos} video</span>
                      </span>
                      {sel === p.id ? <span className="h-2 w-2 shrink-0 rounded-full bg-[#F2793C]" /> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              <Field aria-label="Tên sản phẩm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên sản phẩm" />
              <Field aria-label="Mô tả" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Mô tả sản phẩm" />
              <Field aria-label="Đường dẫn affiliate" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
              <Btn variant="accent" busy={create.isPending} disabled={!name || create.isPending} onClick={() => create.mutate()} className="w-full">
                Thêm sản phẩm
              </Btn>
            </div>
          </Card>
        </div>

        <div className="space-y-3 lg:col-span-3">
          {!sel ? (
            <EmptyState icon="→" title="Chọn một sản phẩm để bắt đầu." />
          ) : (
            <>
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="section-title">{selected?.name}</h2>
                  <Btn size="sm" busy={analyze.isPending} disabled={analyze.isPending} onClick={() => analyze.mutate()}>Phân tích bằng AI</Btn>
                </div>
                <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
                  <Select aria-label="Kiểu kịch bản" value={style} onChange={(e) => setStyle(e.target.value)} className="sm:max-w-52">
                    {Object.entries(STYLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                  <Btn variant="accent" busy={genScript.isPending} disabled={genScript.isPending} onClick={() => genScript.mutate()} className="flex-1">Tạo kịch bản</Btn>
                </div>
                {msg ? <p className="mt-2 rounded-lg bg-bg px-2.5 py-2 text-xs text-secondary">{msg}</p> : null}
              </Card>
              <h3 className="section-title">Kịch bản ({scripts.data?.data.length ?? 0})</h3>
              {(scripts.data?.data ?? []).map((s) => (
                <Card key={s.id} className="!p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge badge-info">{STYLES[s.style] ?? s.style}</span>
                    {s.disclosure_injected
                      ? <span className="badge badge-warn">Đã chèn công bố</span>
                      : <span className="badge badge-ok">Có công bố</span>}
                  </div>
                  <p className="mt-1.5 font-semibold">{s.hook}</p>
                  <p className="mt-1 text-sm text-secondary">{s.body}</p>
                  <p className="mt-1 text-sm text-[#F7A672]">{s.cta}</p>
                  <p className="mt-1.5 rounded-lg bg-bg px-2.5 py-2 text-xs text-secondary">{s.disclosure}</p>
                  <Btn variant="link" onClick={() => genVideo(s.id)} className="mt-2">Tạo video từ kịch bản này →</Btn>
                </Card>
              ))}
              <h3 className="section-title">Video ({videos.data?.data.length ?? 0})</h3>
              {(videos.data?.data ?? []).map((v) => (
                <div key={v.id} className="row-item flex items-center justify-between gap-2">
                  <span className="mono">{v.id.slice(0, 12)}</span>
                  <span className="flex items-center gap-2">
                    <StatusBadge value={v.status} />
                    <Btn variant="link" onClick={() => doExport(v.id)}>Xuất tệp</Btn>
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GripVertical, ImagePlus } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api/client'
import type { AfScript } from '../api/client'
import { EmptyState } from '../components/states'
import { Btn, Card, Field, PageHeader, Select, StatusBadge } from '../components/ui'
import { t } from '../i18n/strings.vi'

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
  const [dropOver, setDropOver] = useState('')
  const [dragScript, setDragScript] = useState<string | null>(null)
  const [overScript, setOverScript] = useState<string | null>(null)

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
      const saved = res.data.saved_to
      setMsg(`Đã xuất tệp: ${res.data.manifest.file}${saved ? ` → ${saved}` : ''}`)
    } catch (e) { setMsg((e as Error).message) }
    qc.invalidateQueries({ queryKey: ['afvideos', sel] })
  }

  const dropImage = async (productId: string, file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { setMsg('Tệp thả vào phải là hình ảnh.'); return }
    try {
      await api.afUploadImage(productId, file)
      setMsg('')
      qc.invalidateQueries({ queryKey: ['afproducts'] })
    } catch (e) { setMsg((e as Error).message) }
  }

  const moveScript = async (id: string, toIndex: number) => {
    try { await api.afMoveScript(id, toIndex); setMsg('') }
    catch (e) { setMsg((e as Error).message) }
    qc.invalidateQueries({ queryKey: ['afscripts', sel] })
  }

  const onScriptDrop = (list: AfScript[], targetId: string) => {
    if (!dragScript || dragScript === targetId) return
    const toIndex = list.findIndex((s) => s.id === targetId)
    if (toIndex >= 0) void moveScript(dragScript, toIndex)
    setDragScript(null)
    setOverScript(null)
  }

  const selected = products.data?.data.find((p) => p.id === sel)
  const scriptList = [...(scripts.data?.data ?? [])].sort((a, b) => a.position - b.position)

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
                  <li
                    key={p.id}
                    onDragOver={(e) => { e.preventDefault(); setDropOver(p.id) }}
                    onDragLeave={() => setDropOver((d) => (d === p.id ? '' : d))}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDropOver('')
                      void dropImage(p.id, e.dataTransfer.files?.[0])
                    }}
                    className={`rounded-xl transition-colors ${dropOver === p.id ? 'ring-2 ring-accent' : ''}`}
                    title={t('affiliate.drop.image')}
                  >
                    <button
                      onClick={() => { setSel(p.id); setMsg('') }}
                      className={`row-item row-item-hover flex w-full items-center gap-2.5 !p-3 text-left ${sel === p.id ? '!border-accent/45 bg-tint' : ''}`}
                    >
                      {p.image_path ? (
                        <img
                          src={api.affiliateImageUrl(p.id)}
                          alt=""
                          aria-hidden="true"
                          className="h-10 w-10 shrink-0 rounded-lg border border-border object-cover"
                        />
                      ) : (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-panel text-muted" aria-hidden="true">
                          <ImagePlus className="h-4 w-4" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{p.name}</span>
                        <span className="mono text-muted">{p.price} · {p.videos} video</span>
                      </span>
                      {sel === p.id ? <span className="h-2 w-2 shrink-0 rounded-full bg-accent" /> : null}
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
              <p className="text-[11px] text-muted">{t('affiliate.drop.image')}</p>
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
                {selected?.image_path ? (
                  <img
                    src={api.affiliateImageUrl(selected.id)}
                    alt={selected.name}
                    className="mt-2.5 max-h-44 w-full rounded-xl border border-border object-cover"
                  />
                ) : null}
                <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
                  <Select aria-label="Kiểu kịch bản" value={style} onChange={(e) => setStyle(e.target.value)} className="sm:max-w-52">
                    {Object.entries(STYLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                  <Btn variant="accent" busy={genScript.isPending} disabled={genScript.isPending} onClick={() => genScript.mutate()} className="flex-1">Tạo kịch bản</Btn>
                </div>
                {msg ? <p className="mt-2 rounded-lg bg-panel px-2.5 py-2 text-xs text-secondary">{msg}</p> : null}
              </Card>
              <h3 className="section-title">Kịch bản ({scriptList.length})</h3>
              <p className="text-[11px] text-muted">{t('affiliate.scripts.reorder.hint')}</p>
              {scriptList.map((s, i) => (
                <Card
                  key={s.id}
                  className={`!p-4 transition-shadow ${dragScript === s.id ? 'opacity-60' : ''} ${overScript === s.id && dragScript ? 'ring-2 ring-accent' : ''}`}
                >
                  <div
                    draggable
                    onDragStart={() => setDragScript(s.id)}
                    onDragEnd={() => { setDragScript(null); setOverScript(null) }}
                    onDragOver={(e) => { e.preventDefault(); setOverScript(s.id) }}
                    onDrop={() => onScriptDrop(scriptList, s.id)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex cursor-grab items-center gap-1 text-muted" title={t('affiliate.scripts.reorder.hint')} aria-hidden="true">
                        <GripVertical className="h-4 w-4" />
                        <span className="mono">#{i + 1}</span>
                      </span>
                      <span className="badge badge-info">{STYLES[s.style] ?? s.style}</span>
                      {s.disclosure_injected
                        ? <span className="badge badge-warn">Đã chèn công bố</span>
                        : <span className="badge badge-ok">Có công bố</span>}
                    </div>
                    <p className="mt-1.5 font-semibold">{s.hook}</p>
                    <p className="mt-1 text-sm text-secondary">{s.body}</p>
                    <p className="mt-1 text-sm text-ember">{s.cta}</p>
                    <p className="mt-1.5 rounded-lg bg-panel px-2.5 py-2 text-xs text-secondary">{s.disclosure}</p>
                    <Btn variant="link" onClick={() => genVideo(s.id)} className="mt-2">Tạo video từ kịch bản này →</Btn>
                  </div>
                </Card>
              ))}
              <h3 className="section-title">Video ({videos.data?.data.length ?? 0})</h3>
              {(videos.data?.data ?? []).map((v) => (
                <div key={v.id} className="row-item space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="mono">{v.id.slice(0, 12)}</span>
                    <span className="flex items-center gap-2">
                      <StatusBadge value={v.status} />
                      <Btn variant="link" onClick={() => doExport(v.id)}>Xuất tệp</Btn>
                    </span>
                  </div>
                  <img
                    src={api.affiliateVisualUrl(v.id)}
                    alt=""
                    aria-hidden="true"
                    className="max-h-48 w-full rounded-lg border border-border object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

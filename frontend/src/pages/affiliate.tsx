import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GripVertical, ImagePlus, Send } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api/client'
import type { AfScript, AfVideo } from '../api/client'
import { EmptyState } from '../components/states'
import { Btn, Card, Field, PageHeader, Select, StatusBadge } from '../components/ui'
import { VideoPlayer } from '../components/player'
import { t } from '../i18n/strings.vi'

const STYLES: Record<string, string> = {
  REVIEW: 'Đánh giá', UGC: 'Người dùng thật', PROBLEM_SOLUTION: 'Vấn đề và giải pháp',
  SHOWCASE: 'Trình diễn sản phẩm', COMPARISON: 'So sánh', STORYTELLING: 'Kể chuyện',
  TOP_PRODUCT: 'Sản phẩm nổi bật',
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" role="img" aria-label={`Hoàn thành ${pct}%`}>
      <circle cx="36" cy="36" r={r} fill="none" strokeWidth="7" className="stroke-border" />
      <circle
        cx="36" cy="36" r={r} fill="none" strokeWidth="7" strokeLinecap="round"
        className="stroke-accent transition-[stroke-dashoffset] duration-500"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0, Math.min(100, pct)) / 100)}
        transform="rotate(-90 36 36)"
      />
    </svg>
  )
}

/** Vertical 9:16 job frame. Blurred product still + REAL percent while
 * rendering; player when done; honest error when failed. */
function JobFrame({ v, stillSrc, onRender }: { v: AfVideo; stillSrc: string | null; onRender: () => void }) {
  const pct = Math.max(0, Math.min(100, v.progress ?? 0))
  if (v.has_video) {
    return (
      <VideoPlayer
        src={api.affiliateFileUrl(v.id)}
        title={`${v.id.slice(0, 12)}${v.duration_s ? ` · ${v.duration_s.toFixed(1)}s` : ''}`}
        downloadName={`${v.id}.mp4`}
      />
    )
  }
  return (
    <div className="relative mx-auto aspect-[9/16] max-h-80 w-full max-w-60 overflow-hidden rounded-xl border border-border bg-panel">
      {stillSrc ? (
        <img
          src={stillSrc}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-md"
        />
      ) : null}
      <div className="absolute inset-0 bg-black/45" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
        {v.status === 'FAILED' ? (
          <>
            <p className="text-sm font-semibold text-red-300">Dựng thất bại</p>
            <Btn variant="accent" size="sm" onClick={onRender}>Dựng lại</Btn>
          </>
        ) : (
          <>
            <ProgressRing pct={v.status === 'RENDERING' ? pct : 0} />
            <p className="text-lg font-extrabold tabular-nums text-white">
              {v.status === 'RENDERING' ? `${pct}%` : 'Chờ dựng'}
            </p>
            <p className="text-[11px] text-white/70">
              {v.status === 'RENDERING' ? 'Đang dựng video thật' : 'Nhấn Dựng video để bắt đầu'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

type ChatMsg = { from: 'user' | 'ai'; text: string }

function ReviseChat({ videoId, onRevise }: { videoId: string; onRevise: (id: string, msg: string) => Promise<string> }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    setBusy(true)
    setMsgs((m) => [...m, { from: 'user', text }])
    try {
      const reply = await onRevise(videoId, text)
      setMsgs((m) => [...m, { from: 'ai', text: reply }])
    } catch (e) {
      setMsgs((m) => [...m, { from: 'ai', text: `Lỗi: ${(e as Error).message}` }])
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="rounded-xl border border-border bg-panel p-2.5">
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-secondary">Yêu cầu AI chỉnh sửa</p>
      {msgs.length > 0 ? (
        <ul className="mb-2 max-h-40 space-y-1.5 overflow-y-auto">
          {msgs.map((m, i) => (
            <li
              key={i}
              className={`max-w-[90%] rounded-lg px-2.5 py-1.5 text-[13px] ${m.from === 'user' ? 'ml-auto bg-accent text-white' : 'bg-raised text-ink'}`}
            >
              {m.text}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-1.5">
        <Field
          aria-label="Nhắn yêu cầu chỉnh sửa cho AI"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void send() }}
          placeholder="Ví dụ: làm hook ngắn gọn hơn…"
          className="flex-1"
        />
        <Btn variant="accent" size="sm" busy={busy} disabled={!draft.trim() || busy} onClick={() => void send()} aria-label="Gửi yêu cầu">
          <Send className="h-4 w-4" aria-hidden="true" />
        </Btn>
      </div>
    </div>
  )
}

function VideoJobCard({ v, stillSrc, onRender, onExport, onRevise }: {
  v: AfVideo
  stillSrc: string | null
  onRender: (id: string) => void
  onExport: (id: string) => void
  onRevise: (id: string, msg: string) => Promise<string>
}) {
  return (
    <div className="row-item space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="mono">{v.id.slice(0, 12)}</span>
        <span className="flex items-center gap-2">
          <StatusBadge value={v.status} />
          {v.has_video ? (
            <a
              href={api.affiliateFileUrl(v.id)}
              download={`${v.id}.mp4`}
              className="link-accent text-[13px]"
            >
              Tải video
            </a>
          ) : v.status !== 'RENDERING' ? (
            <Btn variant="link" onClick={() => onRender(v.id)}>Dựng video</Btn>
          ) : null}
          <a
            href={api.affiliateVisualUrl(v.id)}
            download={`${v.id}.png`}
            className="link-accent text-[13px]"
          >
            Tải ảnh
          </a>
          <Btn variant="link" onClick={() => onExport(v.id)}>Xuất tệp</Btn>
        </span>
      </div>
      <JobFrame v={v} stillSrc={stillSrc} onRender={() => onRender(v.id)} />
      <ReviseChat videoId={v.id} onRevise={onRevise} />
    </div>
  )
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
  const videos = useQuery({
    queryKey: ['afvideos', sel],
    queryFn: () => api.afVideos(sel),
    enabled: !!sel,
    refetchInterval: 3000,
  })

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
  const renderVideo = async (videoId: string) => {
    try { await api.afRenderVideo(videoId); setMsg('') }
    catch (e) { setMsg((e as Error).message) }
    qc.invalidateQueries({ queryKey: ['afvideos', sel] })
  }
  const reviseVideo = async (videoId: string, message: string): Promise<string> => {
    const res = await api.afReviseScript(videoId, message)
    qc.invalidateQueries({ queryKey: ['afscripts', sel] })
    return `AI đã viết lại kịch bản mới. Nhấn Dựng video để dựng lại từ bản mới.`
  }
  const doExport = async (videoId: string) => {
    try {
      const res = await api.afExportVideo(videoId)
      setMsg(`Đã xuất tệp: ${res.data.manifest.file}`)
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
                <VideoJobCard
                  key={v.id}
                  v={v}
                  stillSrc={selected?.image_path ? api.affiliateImageUrl(selected.id) : null}
                  onRender={renderVideo}
                  onExport={doExport}
                  onRevise={reviseVideo}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

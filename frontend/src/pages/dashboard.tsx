import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CalendarClock, Film, FolderKanban, ListVideo, Play } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { Project } from '../api/client'
import { ErrorState } from '../components/states'
import { Card, SkeletonList, Stat, StatusBadge } from '../components/ui'
import { labelVi, t } from '../i18n/strings.vi'

type CheckState = { status: string; detail?: string }

/** User-facing capability derived from a real diagnostics check key. No raw enums. */
type Capability = {
  label: string
  checkKey: string
  ready: string
  needsSetup: string
  cta: string
  to: string
}

const CAPABILITIES: Capability[] = [
  { label: 'Bộ định tuyến AI', checkKey: 'ai_router', ready: 'Sẵn sàng', needsSetup: 'Chưa cấu hình', cta: 'Cấu hình ngay', to: '/ai/models' },
  { label: 'Động cơ dựng video', checkKey: 'ffmpeg', ready: 'Sẵn sàng', needsSetup: 'Chưa cấu hình', cta: 'Kiểm tra', to: '/diagnostics' },
  { label: 'Tự động hoá', checkKey: 'scheduler', ready: 'Sẵn sàng', needsSetup: 'Chưa cấu hình', cta: 'Thiết lập', to: '/autopilot' },
  { label: 'Bộ đăng bài', checkKey: 'publisher', ready: 'Sẵn sàng', needsSetup: 'Chưa kết nối', cta: 'Kết nối', to: '/publisher' },
]

const PRESETS = [
  'dashboard.preset.kids',
  'dashboard.preset.review',
  'dashboard.preset.facts',
  'dashboard.preset.calm',
] as const

const PRESET_IDEAS: Record<string, string> = {
  'dashboard.preset.kids': 'Một câu chuyện thiếu nhi về tình bạn trong rừng',
  'dashboard.preset.review': 'Review một sản phẩm son dưỡng theo phong cách UGC',
  'dashboard.preset.facts': 'Video kiến thức 60 giây: vì sao trời xanh',
  'dashboard.preset.calm': 'Video thiền thư giãn với thiên nhiên',
}

const THUMB_GRADS = [
  'radial-gradient(circle at 30% 25%,rgba(251,191,36,0.55),transparent 30%),linear-gradient(180deg,#1e3a2f 0%,#0f1e1a 45%,#080f12 100%)',
  'radial-gradient(circle at 40% 70%,rgba(139,124,246,0.5),transparent 40%),linear-gradient(180deg,#2a1d3d 0%,#1a1224 55%,#0a0712 100%)',
  'radial-gradient(circle at 50% 40%,rgba(96,165,250,0.45),transparent 45%),linear-gradient(135deg,#0a2530 0%,#152028 50%,#0a0e13 100%)',
  'radial-gradient(circle at 60% 30%,rgba(244,114,182,0.4),transparent 45%),linear-gradient(160deg,#2a1d3d 0%,#12101a 60%,#0a0712 100%)',
]

function thumbGrad(id: string): string {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return THUMB_GRADS[h % THUMB_GRADS.length]
}

function fmtDur(sec?: number | null): string {
  const s = Math.max(0, Math.round(sec ?? 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function dotFor(status: string): string {
  if (['SUCCEEDED', 'COMPLETED', 'READY', 'EXPORTED', 'APPROVED'].includes(status)) return 'bg-ok'
  if (['RUNNING', 'GENERATING', 'QUEUED', 'RENDERING'].includes(status)) return 'bg-cyan'
  if (['SCHEDULED', 'AWAITING_APPROVAL', 'REVIEW'].includes(status)) return 'bg-accent'
  return 'bg-warn'
}

function timeAgo(iso?: string): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return ''
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'vừa xong'
  if (min < 60) return `${min} phút trước`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} giờ trước`
  return `${Math.floor(hr / 24)} ngày trước`
}

function ProjectThumb({ projectId, seed }: { projectId: string; seed: string }) {
  const arts = useQuery({
    queryKey: ['thumb', projectId],
    queryFn: () => api.sceneArtifactsAll(projectId),
    staleTime: 60000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
  const img = (arts.data?.data ?? []).find((a) => a.kind === 'IMAGE')
  if (!img) return <div className="absolute inset-0" style={{ background: thumbGrad(seed) }} aria-hidden="true" />
  return <img src={api.artifactUrl(img.id)} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />
}

function ProjectCard({ p }: { p: Project }) {
  const isAffiliate = p.factory_type === 'affiliate'
  return (
    <Link
      to={isAffiliate ? '/affiliate' : `/story/${p.id}`}
      className="group overflow-hidden rounded-xl border border-border bg-surface transition-all duration-hover hover:-translate-y-0.5 hover:border-ink/30"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-panel">
        <ProjectThumb projectId={p.id} seed={p.id} />
        <span className="absolute left-2.5 top-2.5 rounded-md border border-white/15 bg-black/70 px-2 py-0.5 text-[10.5px] font-medium text-white backdrop-blur">
          {isAffiliate ? 'Affiliate' : (p.audience || 'Story')}
        </span>
        <span className="absolute inset-0 m-auto flex h-[52px] w-[52px] scale-90 items-center justify-center rounded-full border border-white/15 bg-black/85 opacity-0 backdrop-blur transition-all duration-hover group-hover:scale-100 group-hover:opacity-100" aria-hidden="true">
          <Play className="ml-0.5 h-[18px] w-[18px] text-white" fill="currentColor" />
        </span>
        <span className="mono absolute bottom-2.5 right-2.5 rounded bg-black/75 px-1.5 py-0.5 text-[11px] text-white backdrop-blur">
          {fmtDur(p.duration_target)}
        </span>
      </div>
      <div className="p-3.5">
        <p className="flex items-center gap-2 truncate text-sm font-semibold">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotFor(p.status)}`} aria-hidden="true" />
          <span className="truncate">{p.name}</span>
        </p>
        <p className="mt-1 truncate text-[11.5px] text-muted">
          {p.updated_at ? `Cập nhật ${timeAgo(p.updated_at)}` : (isAffiliate ? 'Affiliate Factory' : 'Story Factory')}
        </p>
      </div>
    </Link>
  )
}

function HeroPrompt() {
  const navigate = useNavigate()
  const [idea, setIdea] = useState('')
  const [dur, setDur] = useState('30')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    const text = idea.trim()
    if (!text || busy) return
    setBusy(true)
    setErr('')
    try {
      const res = await api.createProject({
        name: text.slice(0, 40),
        description: text,
        factory_type: 'story',
        duration_target: Number(dur) || 30,
      })
      navigate(`/story/${res.data.id}`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const now = new Date()
  const greet = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }).format(now)
  const clock = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(now)

  return (
    <section className="relative mb-9 pb-1 pt-2">
      <div aria-hidden="true" className="pointer-events-none absolute -top-20 left-[20%] right-[20%] h-[280px] rounded-full bg-accent/15 blur-[60px]" />
      <p className="mb-1.5 text-[12.5px] tracking-wide text-secondary">
        {greet} · <b className="mono font-medium text-secondary">{clock}</b>
      </p>
      <h1 className="mb-6 max-w-2xl text-[26px] font-semibold leading-tight tracking-tight md:text-[34px]">
        {t('dashboard.hero.t1')}{' '}
        <em className="bg-gradient-to-r from-accent to-cyan bg-clip-text not-italic text-transparent">
          {t('dashboard.hero.t2')}
        </em>{' '}
        {t('dashboard.hero.t3')}
      </h1>
      <div className="relative max-w-[820px]">
        <div aria-hidden="true" className="pointer-events-none absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-accent to-cyan opacity-25 blur-[20px]" />
        <div className="relative rounded-xl border border-border bg-surface transition-colors focus-within:border-ink/30">
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit() }}
            placeholder={t('dashboard.hero.ph')}
            aria-label={t('dashboard.hero.ph')}
            rows={2}
            className="w-full resize-none bg-transparent px-5 pb-1 pt-[18px] text-[15px] leading-relaxed text-ink outline-none placeholder:text-muted"
          />
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3.5">
            <div className="flex flex-1 flex-wrap gap-1.5">
              {PRESETS.map((k) => (
                <button
                  key={k}
                  onClick={() => setIdea(PRESET_IDEAS[k])}
                  className="rounded-full border border-border bg-panel px-2.5 py-1 text-[11.5px] font-medium text-secondary transition-colors duration-hover hover:bg-raised hover:text-ink"
                >
                  {t(k)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {['15', '30', '60'].map((d) => (
                <button
                  key={d}
                  onClick={() => setDur(d)}
                  aria-pressed={dur === d}
                  className={`rounded-lg border px-2.5 py-1.5 text-[13px] font-semibold transition-colors duration-hover ${
                    dur === d ? 'border-accent bg-accent/10 text-ink' : 'border-border bg-panel text-secondary hover:text-ink'
                  }`}
                >
                  {d}s
                </button>
              ))}
              <button onClick={() => void submit()} disabled={!idea.trim() || busy} className="btn btn-accent">
                {t('dashboard.hero.plan')}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
          {err ? <p className="px-5 pb-3 text-[13px] text-bad">{err}</p> : null}
        </div>
      </div>
    </section>
  )
}

export function DashboardPage() {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects, retry: 1 })
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api.jobs(), retry: 1 })
  const analytics = useQuery({ queryKey: ['analytics'], queryFn: api.analytics, retry: 1 })
  const diag = useQuery({ queryKey: ['diagnostics'], queryFn: api.diagnostics, retry: 1 })
  const activity = useQuery({ queryKey: ['activity'], queryFn: api.activity, retry: 1 })

  const recent = [...(projects.data?.data ?? [])]
    .sort((a, b) => new Date(b.updated_at ?? b.created_at ?? 0).getTime() - new Date(a.updated_at ?? a.created_at ?? 0).getTime())
    .slice(0, 6)

  const jobsList = jobs.data?.data ?? []
  const activeJobs = jobsList.filter((j) => j.status === 'RUNNING' || j.status === 'QUEUED').length
  const failedJobs = jobsList.filter((j) => j.status === 'FAILED').length

  const prod = analytics.data?.data.production as Record<string, number> | undefined
  const automation = analytics.data?.data.automation as Record<string, number> | undefined
  const publishing = analytics.data?.data.publishing

  const checks = (diag.data?.checks ?? {}) as Record<string, CheckState>

  return (
    <div className="space-y-6">
      <HeroPrompt />

      {/* Real counts only. */}
      <div className="grid-4">
        <Stat
          label="Dự án"
          value={projects.data ? projects.data.data.length : '…'}
          sub="đang có trong nhà máy"
          icon={<FolderKanban className="h-4 w-4" aria-hidden="true" />}
        />
        <Stat
          label="Video đã dựng"
          value={prod ? Number(prod.videos) : '…'}
          sub={prod ? `${Number(prod.exports)} đã xuất tệp` : ''}
          icon={<Film className="h-4 w-4" aria-hidden="true" />}
        />
        <Stat
          label="Hàng đợi"
          value={jobs.data ? activeJobs : '…'}
          sub={jobs.data ? (failedJobs > 0 ? `${failedJobs} tác vụ lỗi` : 'tác vụ đang chờ hoặc chạy') : ''}
          icon={<ListVideo className="h-4 w-4" aria-hidden="true" />}
        />
        <Stat
          label="Lịch đăng"
          value={automation ? automation.scheduled : '…'}
          sub={publishing ? `${publishing.confirmed} video đã đăng` : ''}
          icon={<CalendarClock className="h-4 w-4" aria-hidden="true" />}
        />
      </div>

      <div>
        <div className="mb-4 flex items-baseline gap-3">
          <h2 className="text-[15px] font-semibold tracking-tight">Dự án gần đây</h2>
          <span className="text-[12.5px] text-muted">
            {projects.data ? `${recent.length} trong số ${projects.data.data.length} dự án` : ''}
          </span>
          {recent.length > 0 ? <Link to="/story" className="link-accent ml-auto text-[13px]">Xem tất cả →</Link> : null}
        </div>
        {projects.isPending ? <SkeletonList rows={3} /> : null}
        {projects.isError ? (
          <ErrorState message={(projects.error as Error).message} onRetry={() => projects.refetch()} />
        ) : null}
        {projects.data && recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface px-5 py-8 text-center">
            <p className="text-sm font-medium text-secondary">
              Nhà máy chưa có dự án nào. Bắt đầu bằng một câu chuyện hoặc một sản phẩm.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2.5">
              <Link to="/story" className="btn btn-accent">Tạo Story đầu tiên</Link>
              <Link to="/affiliate" className="btn btn-ghost">Tạo Affiliate Video đầu tiên</Link>
            </div>
          </div>
        ) : null}
        {recent.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {recent.map((p) => <ProjectCard key={p.id} p={p} />)}
          </div>
        ) : null}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-5">
        {/* Recent activity inline + factory status */}
        <Card className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="section-title">Hoạt động gần đây</h2>
            <Link to="/ai/router" className="link-accent text-[13px]">Xem AI Router</Link>
          </div>
          <ul className="space-y-1">
            {(activity.data?.data ?? []).slice(0, 6).map((a, i) => (
              <li key={`${a.request_id}-${i}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 py-1.5 text-[13px] last:border-0">
                <span className="truncate text-secondary">
                  {labelVi(a.task)} · {a.provider}/{a.model}
                </span>
                <span className="text-muted">
                  <StatusBadge value={a.status} className="mr-2" />
                  {a.latency_ms}ms
                </span>
              </li>
            ))}
            {(activity.data?.data ?? []).length === 0 ? (
              <li className="py-3 text-center text-[13px] text-muted">Chưa có hoạt động nào.</li>
            ) : null}
          </ul>
        </Card>

        {/* Factory status — user facing, CTA routes to the real page. */}
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="section-title">Trạng thái nhà máy</h2>
            <Link to="/diagnostics" className="link-accent text-[13px]">Chi tiết</Link>
          </div>
          {diag.isPending ? <SkeletonList rows={4} className="[&>div]:h-[54px]" /> : null}
          {diag.isError ? (
            <ErrorState message={(diag.error as Error).message} onRetry={() => diag.refetch()} />
          ) : null}
          {diag.data ? (
            <ul className="space-y-2">
              {CAPABILITIES.map((c) => {
                const state = checks[c.checkKey]?.status
                const ok = state === 'HEALTHY'
                return (
                  <li key={c.checkKey} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-panel px-3 py-2.5">
                    <span className="flex items-center gap-2 text-[13px] font-medium">
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 rounded-full ${ok ? 'bg-ok' : state === 'CONFIG_REQUIRED' ? 'bg-warn' : 'bg-muted'}`}
                      />
                      {c.label}
                    </span>
                    {ok ? (
                      <span className="text-[13px] text-secondary">{c.ready}</span>
                    ) : (
                      <Link to={c.to} className="flex items-center gap-1.5 text-[13px] text-ember hover:underline">
                        {c.needsSetup}
                        <span aria-hidden="true">·</span>
                        {c.cta}
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : null}

          <div className="mt-4 border-t border-border pt-3.5">
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.09em] text-secondary">Tự động hoá</h3>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ['Lượt chạy', automation ? automation.runs : null],
                ['Đã phát', automation ? automation.dispatched : null],
                ['Bỏ lỡ', automation ? automation.missed : null],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-lg bg-panel px-2 py-2">
                  <p className="text-[15px] font-bold">{v === null ? '…' : (v as number)}</p>
                  <p className="text-[10px] text-muted">{k as string}</p>
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex gap-3">
              <Link to="/autopilot" className="link-accent text-[13px]">Auto Pilot</Link>
              <Link to="/queue" className="link-accent text-[13px]">Hàng đợi</Link>
              <Link to="/scheduler" className="link-accent text-[13px]">Lịch đăng</Link>
            </div>
          </div>
        </Card>
      </div>

      {jobs.isError ? (
        <ErrorState
          message={`Không tải được hàng đợi: ${(jobs.error as Error).message}`}
          onRetry={() => jobs.refetch()}
        />
      ) : null}
    </div>
  )
}

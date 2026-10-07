import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { Project } from '../api/client'
import { ErrorState } from '../components/states'
import { Card, SkeletonList, StatusBadge } from '../components/ui'
import { labelVi } from '../i18n/strings.vi'

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

const PIPELINE = [
  'Project', 'AI Director', 'Scene', 'Media', 'TTS', 'Subtitle', 'Render', 'QC', 'Gate', 'Scheduler', 'Publisher',
]

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

function ProjectRow({ p }: { p: Project }) {
  const isAffiliate = p.factory_type === 'affiliate'
  return (
    <li>
      <Link
        to={isAffiliate ? '/affiliate' : `/story/${p.id}`}
        className="row-item row-item-hover flex items-center justify-between gap-3 !py-3"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{p.name}</p>
          <p className="mt-0.5 truncate text-xs text-secondary">
            {isAffiliate ? 'Affiliate Factory' : 'Story Factory'}
            {p.audience ? ` · ${p.audience}` : ''}
            {p.duration_target ? ` · ${p.duration_target}s` : ''}
          </p>
          {p.updated_at ? <p className="mt-0.5 text-[11px] text-muted">Cập nhật {timeAgo(p.updated_at)}</p> : null}
        </div>
        <StatusBadge value={p.status} className="shrink-0" />
      </Link>
    </li>
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
    .slice(0, 5)

  const jobsList = jobs.data?.data ?? []
  const activeJobs = jobsList.filter((j) => j.status === 'RUNNING' || j.status === 'QUEUED').length
  const failedJobs = jobsList.filter((j) => j.status === 'FAILED').length

  const prod = analytics.data?.data.production as Record<string, number> | undefined
  const automation = analytics.data?.data.automation as Record<string, number> | undefined
  const publishing = analytics.data?.data.publishing

  const checks = (diag.data?.checks ?? {}) as Record<string, CheckState>

  return (
    <div className="space-y-6">
      {/* Hero — the factory itself, not a prompt box. */}
      <section className="card !p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#8492A5]">AI Video Factory</p>
        <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-tight">
          Từ ý tưởng đến video đã đăng — tự động hoá toàn bộ.
        </h1>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-secondary">
          Một dự án đi qua đủ chuỗi bước có kiểm soát. Bạn duyệt ở những cổng quyết định, phần còn lại nhà máy chạy.
        </p>

        <ol className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-1.5" aria-label="Chuỗi sản xuất">
          {PIPELINE.map((step, i) => (
            <li key={step} className="flex items-center gap-1.5">
              <span className="rounded-md border border-border bg-bg px-2 py-1 text-[11px] font-medium text-secondary">
                {step}
              </span>
              {i < PIPELINE.length - 1 ? <span aria-hidden="true" className="text-muted">→</span> : null}
            </li>
          ))}
        </ol>

        <div className="mt-5 flex flex-wrap gap-2.5">
          <Link to="/story" className="btn btn-accent">+ Tạo Story</Link>
          <Link to="/affiliate" className="btn btn-ghost">+ Tạo Affiliate Video</Link>
        </div>
      </section>

      {/* Real counts only. */}
      <div className="grid-4">
        <Card>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-secondary">Dự án</p>
          <p className="mt-1.5 text-[22px] font-bold leading-none">
            {projects.data ? projects.data.data.length : '…'}
          </p>
          <p className="mt-1.5 text-[11px] text-muted">đang có trong nhà máy</p>
        </Card>
        <Card>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-secondary">Video đã dựng</p>
          <p className="mt-1.5 text-[22px] font-bold leading-none">{prod ? Number(prod.videos) : '…'}</p>
          <p className="mt-1.5 text-[11px] text-muted">{prod ? `${Number(prod.exports)} đã xuất tệp` : ''}</p>
        </Card>
        <Card>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-secondary">Hàng đợi</p>
          <p className="mt-1.5 text-[22px] font-bold leading-none">{jobs.data ? activeJobs : '…'}</p>
          <p className="mt-1.5 text-[11px] text-muted">
            {jobs.data ? (failedJobs > 0 ? `${failedJobs} tác vụ lỗi` : 'tác vụ đang chờ hoặc chạy') : ''}
          </p>
        </Card>
        <Card>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-secondary">Lịch đăng</p>
          <p className="mt-1.5 text-[22px] font-bold leading-none">{automation ? automation.scheduled : '…'}</p>
          <p className="mt-1.5 text-[11px] text-muted">
            {publishing ? `${publishing.confirmed} video đã đăng` : ''}
          </p>
        </Card>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-5">
        {/* Recent projects */}
        <Card className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="section-title">Dự án gần đây</h2>
            {recent.length > 0 ? <Link to="/story" className="link-accent text-[13px]">Xem tất cả</Link> : null}
          </div>
          {projects.isPending ? <SkeletonList rows={3} /> : null}
          {projects.isError ? (
            <ErrorState message={(projects.error as Error).message} onRetry={() => projects.refetch()} />
          ) : null}
          {projects.data && recent.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-bg px-5 py-8 text-center">
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
            <ul className="space-y-2">
              {recent.map((p) => <ProjectRow key={p.id} p={p} />)}
            </ul>
          ) : null}
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
                  <li key={c.checkKey} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-bg px-3 py-2.5">
                    <span className="flex items-center gap-2 text-[13px] font-medium">
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-400' : state === 'CONFIG_REQUIRED' ? 'bg-amber-400' : 'bg-muted'}`}
                      />
                      {c.label}
                    </span>
                    {ok ? (
                      <span className="text-[13px] text-secondary">{c.ready}</span>
                    ) : (
                      <Link to={c.to} className="flex items-center gap-1.5 text-[13px] text-[#F7A672] hover:underline">
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
                <div key={k as string} className="rounded-lg bg-bg px-2 py-2">
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

      {/* Recent activity — only when the backend actually has records. */}
      {activity.data && activity.data.data.length > 0 ? (
        <Card>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="section-title">Hoạt động gần đây</h2>
            <Link to="/ai/router" className="link-accent text-[13px]">Xem AI Router</Link>
          </div>
          <ul className="space-y-1">
            {activity.data.data.slice(0, 6).map((a, i) => (
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
          </ul>
        </Card>
      ) : null}

      {jobs.isError ? (
        <ErrorState
          message={`Không tải được hàng đợi: ${(jobs.error as Error).message}`}
          onRetry={() => jobs.refetch()}
        />
      ) : null}
    </div>
  )
}
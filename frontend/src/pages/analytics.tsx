import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { ErrorState, LoadingList } from '../components/states'
import { Card, PageHeader } from '../components/ui'
import { statusVi } from '../i18n/strings.vi'

/** Backend aggregates can be null on an empty database — never render NaN. */
function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="section-title mb-2">{title}</h2>
      <div className="space-y-1 text-[13px] text-secondary">{children}</div>
    </Card>
  )
}

function Bars({ rows }: { rows: { label: string; value: number; tone: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (rows.length === 0) return <p className="text-muted">Chưa có dữ liệu.</p>
  return (
    <ul className="space-y-1.5 pt-1">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2">
          <span className="mono w-40 shrink-0 truncate text-muted" title={r.label}>{r.label}</span>
          <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-panel">
            <span className={`block h-full rounded-full ${r.tone}`} style={{ width: `${Math.round((r.value / max) * 100)}%` }} />
          </span>
          <span className="mono w-10 shrink-0 text-right text-ink">{r.value}</span>
        </li>
      ))}
    </ul>
  )
}

export function AnalyticsPage() {
  const q = useQuery({ queryKey: ['analytics'], queryFn: api.analytics, refetchInterval: 10000 })
  if (q.isPending) return <LoadingList rows={5} />
  if (q.isError)
    return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
  const d = q.data.data
  return (
    <div className="space-y-4">
      <PageHeader
        title="Phân tích"
        sub="Số liệu thật từ hệ thống"
        actions={<span className="badge badge-info">Chi phí: {statusVi[d.ai.cost_state] ?? d.ai.cost_state}</span>}
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Section title="Sản xuất">
          <p>Video: <b className="text-ink">{num(d.production.videos)}</b> · Tác vụ: <b className="text-ink">{num(d.production.jobs_total)}</b></p>
          <p>Thành công {num(d.production.jobs_succeeded)} · Lỗi {num(d.production.jobs_failed)} · Bị chặn bởi QC {num(d.production.qc_blocked)}</p>
          <p>Đã xuất {num(d.production.exports)} · Thời gian dựng trung bình {num(d.production.avg_generation_seconds)} giây</p>
          <Bars rows={[
            { label: 'Thành công', value: num(d.production.jobs_succeeded), tone: 'bg-ok' },
            { label: 'Lỗi', value: num(d.production.jobs_failed), tone: 'bg-bad' },
            { label: 'QC chặn', value: num(d.production.qc_blocked), tone: 'bg-warn' },
          ]} />
        </Section>
        <Section title="AI">
          <p>Yêu cầu {num(d.ai.requests)} · Thành công {num(d.ai.successful)} · Dự phòng {num(d.ai.fallbacks)} · Trung bình {num(d.ai.avg_latency_ms)}ms</p>
          <Bars rows={d.ai.by_model.slice(0, 5).map((m) => ({ label: m.model, value: num(m.count), tone: 'bg-accent' }))} />
          {d.ai.by_error.map((e) => <p key={e.code} className="text-ember">Lỗi {e.code}: {num(e.count)}</p>)}
        </Section>
        <Section title="Tự động hoá">
          <p>Lượt chạy {num(d.automation.runs)} · Đã lên lịch {num(d.automation.scheduled)}</p>
          <p>Đã phát {num(d.automation.dispatched)} · Bỏ lỡ {num(d.automation.missed)}</p>
        </Section>
        <Section title="Xuất bản">
          <p>Đã đăng thành công {num(d.publishing.confirmed)} · Lỗi {num(d.publishing.failed)}</p>
          <Bars rows={d.publishing.by_platform.map((p) => ({ label: statusVi[p.platform] ?? p.platform, value: num(p.count), tone: 'bg-accent' }))} />
        </Section>
        <Section title="Affiliate">
          <p>Sản phẩm {num(d.affiliate.products)} · Videos {num(d.affiliate.videos)} · Export {num(d.affiliate.exported)}</p>
        </Section>
      </div>
    </div>
  )
}

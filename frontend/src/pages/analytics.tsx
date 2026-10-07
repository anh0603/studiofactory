import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { ErrorState, LoadingList } from '../components/states'
import { Card, PageHeader } from '../components/ui'
import { statusVi } from '../i18n/strings.vi'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="section-title mb-2">{title}</h2>
      <div className="space-y-1 text-[13px] text-secondary">{children}</div>
    </Card>
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
          <p>Video: <b className="text-ink">{Number(d.production.videos)}</b> · Tác vụ: <b className="text-ink">{Number(d.production.jobs_total)}</b></p>
          <p>Thành công {Number(d.production.jobs_succeeded)} · Lỗi {Number(d.production.jobs_failed)} · Bị chặn bởi QC {Number(d.production.qc_blocked)}</p>
          <p>Đã xuất {Number(d.production.exports)} · Thời gian dựng trung bình {Number(d.production.avg_generation_seconds)} giây</p>
        </Section>
        <Section title="AI">
          <p>Yêu cầu {d.ai.requests} · Thành công {d.ai.successful} · Dự phòng {d.ai.fallbacks} · Trung bình {d.ai.avg_latency_ms}ms</p>
          {d.ai.by_model.slice(0, 5).map((m) => <p key={m.model} className="mono text-muted">{m.model}: {m.count}</p>)}
          {d.ai.by_error.map((e) => <p key={e.code} className="text-accent">Lỗi {e.code}: {e.count}</p>)}
        </Section>
        <Section title="Tự động hoá">
          <p>Lượt chạy {d.automation.runs} · Đã lên lịch {d.automation.scheduled}</p>
          <p>Đã phát {d.automation.dispatched} · Bỏ lỡ {d.automation.missed}</p>
        </Section>
        <Section title="Xuất bản">
          <p>Đã đăng thành công {d.publishing.confirmed} · Lỗi {d.publishing.failed}</p>
          {d.publishing.by_platform.map((p) => <p key={p.platform} className="mono text-muted">{statusVi[p.platform] ?? p.platform}: {p.count}</p>)}
        </Section>
        <Section title="Affiliate">
          <p>Sản phẩm {d.affiliate.products} · Videos {d.affiliate.videos} · Export {d.affiliate.exported}</p>
        </Section>
      </div>
    </div>
  )
}

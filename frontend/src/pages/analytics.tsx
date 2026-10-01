import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { ErrorState, LoadingState } from '../components/states'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-border bg-surface p-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-2 text-sm text-secondary">{children}</div>
    </section>
  )
}

export function AnalyticsPage() {
  const q = useQuery({ queryKey: ['analytics'], queryFn: api.analytics, refetchInterval: 10000 })
  if (q.isPending) return <LoadingState />
  if (q.isError)
    return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
  const d = q.data.data
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Analytics</h1>
      <p className="text-xs text-muted">Số liệu thật từ hệ thống. Chi phí: {d.ai.cost_state} (không bịa giá).</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Sản xuất">
          <p>Videos: {Number(d.production.videos)} · Jobs: {Number(d.production.jobs_total)} (xong {Number(d.production.jobs_succeeded)}, lỗi {Number(d.production.jobs_failed)})</p>
          <p>QC: {Number(d.production.qc_total)} (chặn {Number(d.production.qc_blocked)}) · Exports: {Number(d.production.exports)}</p>
          <p>Thời gian render TB: {Number(d.production.avg_generation_seconds)}s</p>
        </Section>
        <Section title="AI">
          <p>Requests: {d.ai.requests} · Thành công: {d.ai.successful} · Fallback: {d.ai.fallbacks} · TB: {d.ai.avg_latency_ms}ms</p>
          {d.ai.by_model.map((m) => <p key={m.model}>{m.model}: {m.count}</p>)}
          {d.ai.by_error.map((e) => <p key={e.code}>Lỗi {e.code}: {e.count}</p>)}
        </Section>
        <Section title="Tự động hoá">
          <p>Runs: {d.automation.runs} · Đã lên lịch: {d.automation.scheduled} · Đã dispatch: {d.automation.dispatched} · Lỡ: {d.automation.missed}</p>
        </Section>
        <Section title="Xuất bản">
          <p>Đã đăng: {d.publishing.confirmed} · Lỗi: {d.publishing.failed}</p>
          {d.publishing.by_platform.map((p) => <p key={p.platform}>{p.platform}: {p.count}</p>)}
        </Section>
        <Section title="Affiliate">
          <p>Sản phẩm: {d.affiliate.products} · Videos: {d.affiliate.videos} · Đã export: {d.affiliate.exported}</p>
        </Section>
      </div>
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { ErrorState, LoadingList } from '../components/states'
import { Btn, Card, PageHeader, StatusBadge } from '../components/ui'
import { labelVi, statusVi } from '../i18n/strings.vi'

/** Grouped so an operator sees "what must I configure" before raw detail. */
const GROUPS: { title: string; keys: string[]; blurb: string }[] = [
  {
    title: 'Hạ tầng sản xuất',
    keys: ['backend', 'database', 'storage', 'ffmpeg', 'ffprobe'],
    blurb: 'Các thành phần phải có để dựng và kiểm định video.',
  },
  {
    title: 'Trí tuệ nhân tạo',
    keys: ['ai_providers', 'ai_credentials', 'ai_models'],
    blurb: 'Chưa cấu hình thì mọi yêu cầu AI sẽ bị chặn trước khi gọi nhà cung cấp.',
  },
  {
    title: 'Tự động hoá và đăng bài',
    keys: ['scheduler', 'publisher'],
    blurb: 'Lịch đăng và tài khoản đăng bài cần cấu hình riêng.',
  },
]

const ORDER = GROUPS.flatMap((g) => g.keys)

function healthLabel(status: string): string {
  return statusVi[status] ?? status
}

export function DiagnosticsPage() {
  const q = useQuery({ queryKey: ['diagnostics'], queryFn: api.diagnostics, refetchInterval: 10000 })
  if (q.isPending) return <LoadingList rows={6} />
  if (q.isError)
    return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />

  const checks = q.data.checks as Record<string, { status: string; detail?: string }>
  const requestId = (q.data as { request_id?: string }).request_id ?? ''
  const entries = Object.entries(checks).sort(
    (a, b) => {
      const ia = ORDER.indexOf(a[0])
      const ib = ORDER.indexOf(b[0])
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    },
  )
  const needsConfig = entries.filter(([, v]) => v.status === 'CONFIG_REQUIRED').length

  return (
    <div className="space-y-4">
      <PageHeader
        title="Chẩn đoán hệ thống"
        sub={`Kết quả kiểm tra thật từ máy chủ · mã yêu cầu ${requestId.slice(0, 12)}…`}
      />

      {needsConfig > 0 ? (
        <div className="rounded-xl border border-emberline bg-tint px-4 py-3">
          <p className="text-[13px] font-medium text-warn">
            {needsConfig} thành phần chưa cấu hình
          </p>
          <p className="mt-0.5 text-[12px] text-secondary">
            Hệ thống vẫn chạy, nhưng các chức năng phụ thuộc phần này sẽ bị chặn cho tới khi bạn cấu hình.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn size="sm" variant="accent" onClick={() => { window.location.href = '/ai/models' }}>
              Cấu hình nhà cung cấp AI
            </Btn>
          </div>
        </div>
      ) : null}

      {GROUPS.map((g) => {
        const rows = g.keys.filter((k) => checks[k])
        if (rows.length === 0) return null
        return (
          <Card key={g.title}>
            <h2 className="section-title mb-1">{g.title}</h2>
            <p className="mb-2.5 text-[12px] text-muted">{g.blurb}</p>
            <ul className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((key) => {
                const value = checks[key]
                return (
                  <li key={key} className="row-item flex h-full items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{labelVi(key)}</p>
                      {value.detail ? (
                        <p className="mono mt-1 line-clamp-2 break-all text-secondary" title={value.detail}>
                          {value.detail}
                        </p>
                      ) : null}
                    </div>
                    <StatusBadge value={value.status} label={healthLabel(value.status)} raw={false} className="shrink-0" />
                  </li>
                )
              })}
            </ul>
          </Card>
        )
      })}

      {entries.filter(([k]) => !ORDER.includes(k)).length > 0 ? (
        <Card>
          <h2 className="section-title mb-2.5">Thành phần khác</h2>
          <ul className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {entries.filter(([k]) => !ORDER.includes(k)).map(([key, value]) => (
              <li key={key} className="row-item flex h-full items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{labelVi(key)}</p>
                  {value.detail ? <p className="mono mt-1 break-all text-secondary">{value.detail}</p> : null}
                </div>
                <StatusBadge value={value.status} label={healthLabel(value.status)} raw={false} className="shrink-0" />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  )
}
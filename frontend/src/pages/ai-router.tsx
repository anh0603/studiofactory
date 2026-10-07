import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { TraceStep } from '../api/client'
import { EmptyState, ErrorState } from '../components/states'
import { Btn, Card, Field, PageHeader, ProgressNote, Select, Spinner } from '../components/ui'
import { errorCodeVi, labelVi, statusVi } from '../i18n/strings.vi'

export function AiRouterPage() {
  const nav = useNavigate()
  const [cap, setCap] = useState('TEXT')
  const [strategy, setStrategy] = useState('AUTO')
  const [prompt, setPrompt] = useState('Xin chào')
  const [result, setResult] = useState<{ output?: string; error?: { code: string; message: string }; trace: TraceStep[] } | null>(null)

  const STRATEGIES: Record<string, string> = {
    AUTO: 'Tự động', PRIORITY: 'Theo ưu tiên', WEIGHTED: 'Theo trọng số',
    FASTEST: 'Nhanh nhất', CHEAPEST: 'Rẻ nhất',
  }
  const CAPS_VI: Record<string, string> = {
    TEXT: 'Văn bản', STORY: 'Truyện', VISION: 'Thị giác', IMAGE: 'Hình ảnh',
    VIDEO: 'Video', TTS: 'Giọng đọc', MUSIC: 'Nhạc nền', SFX: 'Hiệu ứng', EMBEDDING: 'Vector',
  }

  const eligible = useQuery({ queryKey: ['eligible', cap], queryFn: () => api.routerEligible(cap) })
  const activity = useQuery({ queryKey: ['activity'], queryFn: api.activity, refetchInterval: 5000 })
  const usage = useQuery({ queryKey: ['usage'], queryFn: api.usage })

  const generate = useMutation({
    mutationFn: () => api.routerGenerate({ task: 'SCRIPT_GENERATION', capability: cap, prompt, strategy }),
    onSuccess: (res) => setResult({ output: res.data?.output, error: res.error, trace: res.trace }),
    onError: (e: unknown) => {
      const err = e as Error & { code?: string }
      setResult({ error: { code: err.code ?? 'UNKNOWN_ERROR', message: err.message }, trace: [] })
    },
  })

  return (
    <div className="space-y-4">
      <PageHeader title="Bộ định tuyến AI" sub="Chính sách → chọn mô hình → dự phòng có giới hạn → nhật ký đầy đủ" />
      <div className="grid items-start gap-3 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <h2 className="section-title mb-2.5">Chạy thử</h2>
          <div className="space-y-2">
            <div className="flex gap-2">
              <Select aria-label="Chiến lược" value={strategy} onChange={(e) => setStrategy(e.target.value)} className="flex-1">
                {Object.entries(STRATEGIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <Select aria-label="Năng lực" value={cap} onChange={(e) => setCap(e.target.value)} className="flex-1">
                {Object.entries(CAPS_VI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
            <Field aria-label="Nội dung yêu cầu" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <Btn variant="accent" busy={generate.isPending} disabled={generate.isPending} onClick={() => generate.mutate()} className="w-full">Chạy thử định tuyến</Btn>
          </div>
          {generate.isPending ? <div className="mt-2.5"><ProgressNote text="Đang định tuyến…" /></div> : null}
          {result ? (
            <div className="mt-2.5 rounded-lg bg-bg p-3 text-[13px]">
              {result.output ? <p className="text-ink">Kết quả: {result.output}</p> : null}
              {result.error ? (
                <p className="text-[#F7A672]">
                  {errorCodeVi[result.error.code] ?? result.error.code}
                  <span className="mono ml-1 text-[11px] text-muted">{result.error.code}</span>
                </p>
              ) : null}
              <p className="mono mb-1 mt-2 text-muted">Nhật ký:</p>
              {result.trace.length === 0 ? <p className="text-xs text-muted">(bị chặn trước khi gọi mạng — không có lần thử nào)</p> : (
                <ol className="space-y-1 text-xs text-secondary">
                  {result.trace.map((t) => (
                    <li key={t.attempt} className="flex flex-wrap gap-x-1.5 rounded border border-border px-2 py-1">
                      <span className="mono text-[#F7A672]">#{t.attempt}</span>
                      <span>{t.provider}/{t.model}</span>
                      <span>{t.status}{t.error_code !== 'SUCCESS' ? ` ${t.error_code}` : ''}</span>
                      {t.fallback_reason ? <span className="text-muted">→ {t.fallback_reason}</span> : null}
                      <span className="mono ml-auto text-muted">{t.latency_ms}ms</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : null}
        </Card>

        <Card className="lg:col-span-3">
          <h2 className="section-title mb-2">Mô hình đủ điều kiện</h2>
          {eligible.isPending ? <Spinner /> : null}
          {eligible.isError ? <ErrorState message={(eligible.error as Error).message} onRetry={() => eligible.refetch()} /> : null}
          {eligible.data ? (
            <div className="text-sm">
              <p className="mono mb-2 text-muted">Chiến lược áp dụng: {STRATEGIES[eligible.data.data.strategy_resolved] ?? eligible.data.data.strategy_resolved}</p>
              {eligible.data.data.eligible.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-[#10141A] px-4 py-6 text-center">
                  <p className="text-[13px] font-medium text-secondary">Chưa có model khả dụng</p>
                  <p className="mx-auto mt-1 max-w-md text-[12px] text-muted">
                    Không có mô hình nào vượt qua điều kiện: năng lực, khoá truy cập, lớp chi phí và giấy phép.
                    Mọi yêu cầu AI sẽ bị chặn trước khi gọi nhà cung cấp.
                  </p>
                  <Btn variant="accent" className="mt-3" onClick={() => nav('/ai/models')}>
                    Cấu hình model
                  </Btn>
                </div>
              ) : (
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {eligible.data.data.eligible.map((m) => (
                    <li key={m.id} className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-2.5 py-1.5 text-[13px]">
                      {m.name} <span className="mono text-muted">· P{m.priority}</span>
                    </li>
                  ))}
                </ul>
              )}
              {eligible.data.data.excluded.length > 0 ? (
                <div className="mt-2">
                  <p className="text-xs font-medium text-secondary">Bị loại khỏi danh sách</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted">
                    {eligible.data.data.excluded.map((e, i) => (
                      <li key={i}>
                        <span className="mono">{e.model}</span>: {errorCodeVi[e.reason] ?? e.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <Card>
          <h2 className="section-title mb-2">Hoạt động AI gần nhất</h2>
          {(activity.data?.data.length ?? 0) === 0 ? (
            <p className="py-6 text-center text-[13px] text-secondary">
              Chưa có hoạt động nào được ghi nhận. Mỗi lần bạn thử sinh nội dung — kể cả khi bị chặn
              trước khi gọi nhà cung cấp — sẽ xuất hiện ở đây.
            </p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto text-xs text-secondary">
              {activity.data!.data.slice(0, 20).map((a, i) => {
                const called = a.attempt >= 1
                return (
                  <li key={i} className="border-b border-border/50 py-1 last:border-0">
                    <div className="flex justify-between gap-2">
                      <span className="truncate">
                        {labelVi(a.task)} · {called ? `${a.provider}/${a.model}` : 'chưa gọi nhà cung cấp'}
                      </span>
                      <span className="mono shrink-0 text-muted">
                        {statusVi[a.status] ?? a.status}
                        {a.error_category ? ` · ${errorCodeVi[a.error_category] ?? a.error_category}` : ''}
                      </span>
                    </div>
                    <p className="mono mt-0.5 text-[11px] text-muted">
                      {a.status === 'BLOCKED'
                        ? 'bị chặn trước khi gọi mạng'
                        : `${called ? 'đã gọi nhà cung cấp' : 'chưa gọi'} · ${a.latency_ms}ms`}
                      {a.mock ? ' · giả lập' : ' · thật'}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="section-title mb-2">Mức sử dụng</h2>
          {usage.data ? (() => {
            const rows = activity.data?.data ?? []
            const blocked = rows.filter((r) => r.status === 'BLOCKED').length
            const called = rows.filter((r) => r.attempt >= 1).length
            return (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-center">
                  {[
                    ['Lượt bạn yêu cầu', usage.data.data.requests],
                    ['Thành công', usage.data.data.successful],
                    ['Lượt dự phòng', usage.data.data.fallbacks],
                    ['Chi phí', statusVi[usage.data.data.cost_state] ?? usage.data.data.cost_state],
                  ].map(([k, v]) => (
                    <div key={k as string} className="rounded-lg bg-bg px-2 py-2.5">
                      <p className="text-lg font-bold">{v as React.ReactNode}</p>
                      <p className="text-[11px] font-medium text-secondary">{k as string}</p>
                    </div>
                  ))}
                </div>
                <p className="rounded-lg border border-border bg-bg px-2.5 py-2 text-[12px] text-muted">
                  Trong {rows.length} lượt gần nhất: <strong className="text-secondary">{blocked}</strong> bị
                  chặn trước khi gọi mạng, <strong className="text-secondary">{called}</strong> đã gọi
                  nhà cung cấp. Lượt bị chặn không phải là yêu cầu tới nhà cung cấp nên không tốn credit.
                </p>
              </div>
            )
          })() : <Spinner />}
        </Card>
      </div>
    </div>
  )
}

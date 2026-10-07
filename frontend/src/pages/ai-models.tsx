import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { ExplainError } from '../components/explain-error'
import { EmptyState, ErrorState } from '../components/states'
import { Btn, Card, Field, PageHeader, Select, Spinner, StatusBadge } from '../components/ui'
import { errorCodeVi, statusVi } from '../i18n/strings.vi'

const CAPS: Record<string, string> = {
  TEXT: 'Văn bản', STORY: 'Truyện', VISION: 'Thị giác', IMAGE: 'Hình ảnh',
  VIDEO: 'Video', TTS: 'Giọng đọc', MUSIC: 'Nhạc nền', SFX: 'Hiệu ứng âm thanh',
  EMBEDDING: 'Vector',
}

const COST_CLASSES = [
  { v: 'FREE', label: 'Miễn phí', hint: 'Cho phép dùng khi chính sách chi phí đang tắt' },
  { v: 'FREE_WITH_LIMIT', label: 'Miễn phí có giới hạn', hint: 'Cho phép, nhưng có hạn mức ở phía nhà cung cấp' },
  { v: 'LOCAL', label: 'Chạy nội bộ', hint: 'Không tốn credit' },
  { v: 'PAID', label: 'Trả phí', hint: 'Sẽ bị chặn khi chưa cho phép dùng model trả phí' },
  { v: 'TRIAL', label: 'Dùng thử', hint: 'Tính là trả phí — sẽ bị chặn khi chính sách chi phí tắt' },
  { v: 'UNKNOWN', label: 'Chưa rõ', hint: 'Tính là trả phí — sẽ bị chặn khi chính sách chi phí tắt' },
]

const LICENSES = [
  { v: 'VERIFIED_COMMERCIAL', label: 'Cho phép thương mại', hint: 'Dùng được cả khi yêu cầu giấy phép thương mại' },
  { v: 'VERIFIED_NONCOMMERCIAL', label: 'Chỉ phi thương mại', hint: 'Sẽ bị chặn nếu bật yêu cầu thương mại' },
  { v: 'UNKNOWN', label: 'Chưa rõ', hint: 'Sẽ bị chặn nếu bật yêu cầu thương mại' },
  { v: 'UNVERIFIED', label: 'Chưa xác minh', hint: 'Sẽ bị chặn nếu bật yêu cầu thương mại' },
]

/** Adapters the backend accepts. OpenRouter is one option, not a hardcoded default. */
const ADAPTERS = [
  { v: 'openai_compatible', label: 'OpenAI-compatible (OpenRouter, OpenAI, Groq, Together…)' },
  { v: 'openai', label: 'OpenAI' },
  { v: 'groq', label: 'Groq' },
  { v: 'together', label: 'Together' },
  { v: 'custom', label: 'Tuỳ chỉnh' },
]

const PAID_BLOCKED = new Set(['PAID', 'TRIAL', 'UNKNOWN'])
const COMMERCIAL_OK = new Set(['VERIFIED_COMMERCIAL'])

function blockedReasons(cost: string, lic: string): string[] {
  const out: string[] = []
  if (PAID_BLOCKED.has(cost)) {
    out.push('Mô hình này sẽ bị chặn trước khi gọi nhà cung cấp, vì chi phí trả phí chưa được cho phép.')
  }
  if (!COMMERCIAL_OK.has(lic)) {
    out.push('Khi bật yêu cầu giấy phép thương mại, mô hình này cũng sẽ bị chặn trước khi gọi nhà cung cấp.')
  }
  return out
}

function healthVi(raw: string | null | undefined): string {
  if (!raw) return 'Chưa kiểm tra'
  if (raw === 'UNKNOWN') return 'Chưa kiểm tra'
  return statusVi[raw] ?? raw
}

export function AiModelsPage() {
  const qc = useQueryClient()
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers })
  const models = useQuery({ queryKey: ['models'], queryFn: api.models })

  const [pName, setPName] = useState('')
  const [pUrl, setPUrl] = useState('')
  const [pAdapter, setPAdapter] = useState('openai_compatible')
  const [credFor, setCredFor] = useState('')
  const [credSecret, setCredSecret] = useState('')
  const [credSaved, setCredSaved] = useState('')
  const [mProvider, setMProvider] = useState('')
  const [mName, setMName] = useState('')
  const [mId, setMId] = useState('')
  const [mCap, setMCap] = useState('TEXT')
  const [mCost, setMCost] = useState('FREE')
  const [mLic, setMLic] = useState('VERIFIED_COMMERCIAL')
  const [mPriority, setMPriority] = useState('100')
  const [testResult, setTestResult] = useState<Record<string, { state: string; note?: string; error?: string; mock?: boolean }>>({})

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['providers'] })
    qc.invalidateQueries({ queryKey: ['models'] })
  }

  const createProv = useMutation({
    mutationFn: () => api.createProvider({ name: pName.trim(), base_url: pUrl.trim(), adapter_key: pAdapter }),
    onSuccess: (res) => {
      setPName(''); setPUrl('')
      setCredFor(res.data.id)
      setCredSaved('')
      refresh()
    },
  })
  const saveCred = useMutation({
    mutationFn: () => api.saveCredential(credFor, credSecret),
    onSuccess: () => {
      // Secret is never kept in state after saving, and never shown again.
      setCredSecret('')
      setCredSaved(credFor)
      refresh()
    },
  })
  const createModel = useMutation({
    mutationFn: () => api.createModel({
      provider_id: mProvider, name: mName.trim(), model_id: (mId.trim() || mName.trim()),
      capabilities: [mCap], cost_class: mCost, license_status: mLic,
      priority: Number(mPriority) || 100,
    }),
    onSuccess: () => { setMName(''); setMId(''); refresh() },
  })
  const toggleModel = useMutation({
    mutationFn: (m: { id: string; enabled: boolean }) => api.patchModel(m.id, { enabled: !m.enabled }),
    onSuccess: refresh,
  })
  const deleteModel = useMutation({
    mutationFn: (id: string) => api.deleteModel(id),
    onSuccess: refresh,
  })

  const runTest = async (id: string) => {
    setTestResult((s) => ({ ...s, [id]: { state: 'PENDING' } }))
    try {
      const res = await api.testModel(id, mCap)
      setTestResult((s) => ({ ...s, [id]: { state: res.data.state, note: res.data.note, error: res.data.error, mock: res.data.mock } }))
    } catch (e) {
      const err = e as Error & { code?: string }
      setTestResult((s) => ({ ...s, [id]: { state: 'FAILED', error: err.code ?? err.message } }))
    }
    qc.invalidateQueries({ queryKey: ['models'] })
  }

  if (providers.isPending || models.isPending) return <Spinner />
  if (providers.isError) return <ErrorState message={(providers.error as Error).message} onRetry={() => providers.refetch()} />
  if (models.isError) return <ErrorState message={(models.error as Error).message} onRetry={() => models.refetch()} />

  const providerList = providers.data!.data
  const modelList = models.data!.data
  const warnings = blockedReasons(mCost, mLic)
  const step = providerList.length === 0 ? 1 : modelList.length === 0 ? 3 : 4

  return (
    <div className="space-y-5">
      <PageHeader
        title="Trung tâm mô hình AI"
        sub="Dùng khoá của bạn · khoá được mã hoá và không hiển thị lại sau khi lưu"
      />

      <Card>
        <h2 className="section-title mb-2">Cấu hình theo 3 bước</h2>
        <ol className="grid gap-2 text-[13px] sm:grid-cols-3">
          {[
            { n: 1, label: 'Nhà cung cấp', done: providerList.length > 0 },
            { n: 2, label: 'Khoá truy cập', done: providerList.some((p) => p.credential_configured) },
            { n: 3, label: 'Mô hình', done: modelList.length > 0 },
          ].map((s) => (
            <li
              key={s.n}
              className={`rounded-lg border px-3 py-2 ${step === s.n && !s.done ? 'border-accent bg-[#221610]' : 'border-border bg-bg'}`}
            >
              <p className="font-semibold">
                <span className="mono mr-1.5 text-accent">{s.n}</span>
                {s.label}
              </p>
              <p className="mt-0.5 text-[12px] text-muted">
                {s.done ? 'Đã xong' : step === s.n ? 'Đang làm bước này' : 'Chờ'}
              </p>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <h2 className="section-title mb-2.5">Nhà cung cấp ({providerList.length})</h2>
          {providerList.length === 0 ? (
            <EmptyState icon="◍" title="Chưa có nhà cung cấp." hint="Thêm một dịch vụ OpenAI-compatible rồi lưu khoá của bạn." />
          ) : (
            <ul className="space-y-1.5">
              {providerList.map((p) => (
                <li key={p.id} className="row-item flex items-center justify-between gap-2 !p-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {p.name} <span className="mono font-normal text-muted">{p.adapter_key}</span>
                    </p>
                    <p className="truncate text-xs text-muted">
                      {p.base_url || 'chưa có địa chỉ'} · khoá:{' '}
                      {p.credential_configured ? 'đã cấu hình' : 'chưa cấu hình'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge value={healthVi(p.health) === 'Chưa kiểm tra' ? 'UNKNOWN' : p.health} label={healthVi(p.health)} raw={false} />
                    <Btn variant="link" onClick={() => { setCredFor(p.id); setCredSaved('') }}>
                      {p.credential_configured ? 'Đổi khoá' : 'Nhập khoá'}
                    </Btn>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 space-y-2 border-t border-border pt-3">
            <Field
              aria-label="Tên nhà cung cấp"
              value={pName}
              onChange={(e) => setPName(e.target.value)}
              placeholder="Tên, ví dụ: OpenRouter"
            />
            <Select aria-label="Kiểu kết nối" value={pAdapter} onChange={(e) => setPAdapter(e.target.value)}>
              {ADAPTERS.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
            </Select>
            <Field
              aria-label="Địa chỉ cơ sở"
              value={pUrl}
              onChange={(e) => setPUrl(e.target.value)}
              placeholder="https://…/v1 (ví dụ: https://openrouter.ai/api/v1)"
            />
            <p className="text-[11px] leading-relaxed text-muted">
              Địa chỉ phải là https và không phải máy cục bộ. Bỏ trống nếu dịch vụ dùng địa chỉ mặc định.
            </p>
            <Btn
              variant="accent"
              busy={createProv.isPending}
              disabled={!pName.trim() || createProv.isPending}
              onClick={() => createProv.mutate()}
              className="w-full"
            >
              Thêm nhà cung cấp
            </Btn>
            {createProv.isError ? (
              <ExplainError
                what="Không thêm được nhà cung cấp."
                error={createProv.error}
                todo="Kiểm tra địa chỉ phải bắt đầu bằng https và không trỏ về máy cục bộ."
              />
            ) : null}
          </div>

          {credFor ? (
            <div className="mt-2.5 rounded-lg border border-[#6E4023] bg-[#221610] p-3">
              <p className="text-xs text-secondary">
                Khoá truy cập — nhập một lần, sau đó chỉ hiện trạng thái đã cấu hình.
              </p>
              <div className="mt-1.5 flex gap-2">
                <Field
                  aria-label="Khoá truy cập"
                  type="password"
                  autoComplete="off"
                  value={credSecret}
                  onChange={(e) => setCredSecret(e.target.value)}
                  placeholder="dán khoá của bạn"
                  className="flex-1"
                />
                <Btn
                  variant="accent"
                  size="sm"
                  busy={saveCred.isPending}
                  disabled={!credSecret || saveCred.isPending}
                  onClick={() => saveCred.mutate()}
                >
                  Lưu
                </Btn>
                <Btn size="sm" onClick={() => { setCredFor(''); setCredSecret(''); setCredSaved('') }}>Huỷ</Btn>
              </div>
              {credSaved ? (
                <p className="mt-2 text-[12px] text-secondary">Đã lưu khoá. Giá trị không hiển thị lại.</p>
              ) : null}
              {saveCred.isError ? (
                <div className="mt-2">
                  <ExplainError
                    what="Không lưu được khoá."
                    error={saveCred.error}
                    todo="Kiểm tra khoá có đúng của nhà cung cấp này không."
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>

        <Card>
          <h2 className="section-title mb-2.5">Mô hình ({modelList.length})</h2>
          {modelList.length === 0 ? (
            <EmptyState icon="◇" title="Chưa có mô hình nào." hint="Thêm mô hình cùng năng lực, chi phí và giấy phép để bộ định tuyến dùng được." />
          ) : (
            <ul className="space-y-1.5">
              {modelList.map((m) => {
                const t = testResult[m.id]
                const blocked = blockedReasons(m.cost_class, m.license_status)
                return (
                  <li key={m.id} className="row-item !p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold">{m.name}</p>
                      <StatusBadge
                        value={m.enabled ? 'ACTIVE' : 'DISABLED'}
                        label={m.enabled ? 'Đang bật' : 'Đã tắt'}
                        raw={false}
                        className="shrink-0"
                      />
                    </div>
                    <p className="mono mt-1 break-all text-muted">{m.model_id}</p>
                    <p className="mt-1 text-xs text-secondary">
                      {m.capabilities.map((c) => CAPS[c] ?? c).join(' · ')} · ưu tiên {m.priority} ·{' '}
                      {statusVi[m.cost_class] ?? m.cost_class} ·{' '}
                      {statusVi[m.license_status] ?? m.license_status}
                    </p>
                    <p className="mt-1 text-xs">
                      <span className="text-muted">Tình trạng: </span>
                      <StatusBadge value={healthVi(m.health_status) === 'Chưa kiểm tra' ? 'UNKNOWN' : m.health_status} label={healthVi(m.health_status)} raw={false} />
                    </p>
                    {blocked.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 text-[12px] text-[#E8B04B]">
                        {blocked.map((b) => <li key={b}>Bị chặn: {b}</li>)}
                      </ul>
                    ) : null}
                    {t ? (
                      <p className="mt-1 text-xs text-[#F7A672]">
                        Kiểm tra năng lực {mCap}: {statusVi[t.state] ?? t.state}
                        {t.mock ? ' (giả lập)' : ' (thật)'}
                        {t.error ? ` · ${errorCodeVi[t.error] ?? t.error}` : ''}
                        {t.note ? ` · ${t.note}` : ''}
                      </p>
                    ) : null}
                    <div className="mt-1.5 flex gap-3">
                      <Btn variant="link" onClick={() => toggleModel.mutate(m)}>{m.enabled ? 'Tắt' : 'Bật'}</Btn>
                      <Btn variant="link" busy={t?.state === 'PENDING'} onClick={() => runTest(m.id)}>Kiểm tra năng lực</Btn>
                      <Btn variant="link" onClick={() => deleteModel.mutate(m.id)}>Xoá</Btn>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="mt-3 space-y-2 border-t border-border pt-3">
            <Select aria-label="Nhà cung cấp của mô hình" value={mProvider} onChange={(e) => setMProvider(e.target.value)}>
              <option value="">— Chọn nhà cung cấp —</option>
              {providerList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field aria-label="Tên mô hình" value={mName} onChange={(e) => setMName(e.target.value)} placeholder="Tên hiển thị" />
              <Field aria-label="Mã mô hình" value={mId} onChange={(e) => setMId(e.target.value)} placeholder="mã gửi tới nhà cung cấp" />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Select aria-label="Năng lực" value={mCap} onChange={(e) => setMCap(e.target.value)}>
                {Object.entries(CAPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <Select aria-label="Lớp chi phí" value={mCost} onChange={(e) => setMCost(e.target.value)}>
                {COST_CLASSES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
              </Select>
              <Select aria-label="Giấy phép" value={mLic} onChange={(e) => setMLic(e.target.value)}>
                {LICENSES.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Field
                aria-label="Ưu tiên"
                type="number"
                value={mPriority}
                onChange={(e) => setMPriority(e.target.value)}
                className="w-28"
              />
              <p className="text-[11px] text-muted">Số lớn hơn được chọn trước.</p>
            </div>
            {warnings.length > 0 ? (
              <ul className="space-y-0.5 rounded-lg border border-[#6E4023] bg-[#221610] p-2.5 text-[12px] text-[#E8B04B]">
                {warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            ) : null}
            <Btn
              variant="accent"
              busy={createModel.isPending}
              disabled={!mProvider || !mName.trim() || createModel.isPending}
              onClick={() => createModel.mutate()}
              className="w-full"
            >
              Thêm mô hình
            </Btn>
            {createModel.isError ? (
              <ExplainError
                what="Không thêm được mô hình."
                error={createModel.error}
                todo="Kiểm tra đã chọn nhà cung cấp và tên năng lực còn hợp lệ không."
              />
            ) : null}
            <p className="text-[11px] leading-relaxed text-muted">
              Mô hình mới bắt đầu ở trạng thái “Chưa kiểm tra”. Kiểm tra năng lực chỉ xác nhận tới được
              nhà cung cấp và đúng danh sách model — không khẳng định đã sinh nội dung thành công.
            </p>
          </div>
        </Card>
      </div>
    </div>
  )
}
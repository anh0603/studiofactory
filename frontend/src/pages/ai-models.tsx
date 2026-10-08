import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '../api/client'
import { ExplainError } from '../components/explain-error'
import { EmptyState, ErrorState } from '../components/states'
import { Btn, Card, Field, PageHeader, Select, Spinner, StatusBadge } from '../components/ui'
import { errorCodeVi, statusVi, t as tr } from '../i18n/strings.vi'

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

const LOGO_GRADS = [
  'linear-gradient(135deg,#6d4aff,#22d3ee)',
  'linear-gradient(135deg,#111827,#374151)',
  'linear-gradient(135deg,#0ea5e9,#06b6d4)',
  'linear-gradient(135deg,#ec4899,#f59e0b)',
  'linear-gradient(135deg,#fbbf24,#f97316)',
  'linear-gradient(135deg,#34d399,#22d3ee)',
]

/** One-tap presets: public base URLs only. The key is always the user's own. */
const PRESETS = [
  { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', adapter: 'openai_compatible' },
  { name: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/', adapter: 'openai_compatible' },
  { name: 'Groq', url: 'https://api.groq.com/openai/v1', adapter: 'groq' },
  { name: 'Together', url: 'https://api.together.xyz/v1', adapter: 'together' },
]

function logoFor(name: string): { initials: string; grad: string } {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const clean = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'AI'
  return { initials: clean, grad: LOGO_GRADS[h % LOGO_GRADS.length] }
}

const PAID_BLOCKED = new Set(['PAID', 'TRIAL', 'UNKNOWN'])
const COMMERCIAL_OK = new Set(['VERIFIED_COMMERCIAL'])

/**
 * Guess capabilities from a vendor model id so the operator never has to
 * pick them by hand. Chat models do story too (same endpoint, same skill),
 * vision models also do text. Image/audio models stand alone. Shown as a
 * suggestion — the manual select stays for override.
 */
export function guessCapabilities(modelId: string, name: string): string[] {
  const s = `${modelId} ${name}`.toLowerCase()
  if (/(dall-e|gpt-image|flux|sdxl|stable-diffusion|imagen|midjourney|kandinsky|sd3|image)/.test(s))
    return ['IMAGE']
  if (/(^|[\W_])(tts|text-to-speech|speech|voice|xtts|sovits|bark|melotts|aura)([\W_]|$)/.test(s))
    return ['TTS']
  if (/embed/.test(s)) return ['EMBEDDING']
  if (/(music|musicgen|audio-ldm)/.test(s)) return ['MUSIC']
  if (/(vision|vl-|multimodal|gpt-4o|gpt-4\.1|claude|gemini|qwen.*vl|llama.*vision)/.test(s))
    return ['TEXT', 'STORY', 'VISION']
  return ['TEXT', 'STORY']
}

/** Companion expansion for a manually picked primary capability. */
export function expandCapabilities(primary: string): string[] {
  if (primary === 'VISION') return ['TEXT', 'STORY', 'VISION']
  if (primary === 'TEXT') return ['TEXT', 'STORY']
  return [primary]
}

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
  const usage = useQuery({ queryKey: ['ai-usage'], queryFn: api.usage })
  const quotas = useQuery({
    queryKey: ['ai-quotas'], queryFn: api.quotas,
    refetchInterval: 30000, retry: 1, refetchOnWindowFocus: false,
  })

  const [showAdd, setShowAdd] = useState(false)
  const [showCustom, setShowCustom] = useState(false)
  const [pName, setPName] = useState('')
  const [pUrl, setPUrl] = useState('')
  const [pAdapter, setPAdapter] = useState('openai_compatible')
  const [newKey, setNewKey] = useState('')
  const [provBusy, setProvBusy] = useState(false)
  const [provError, setProvError] = useState<unknown>(null)
  const [credFor, setCredFor] = useState('')
  const [credSecret, setCredSecret] = useState('')
  const [credSaved, setCredSaved] = useState('')
  const [mProvider, setMProvider] = useState('')
  const [mName, setMName] = useState('')
  const [mId, setMId] = useState('')
  const [mCap, setMCap] = useState('TEXT')
  const [showCapSelect, setShowCapSelect] = useState(false)
  const capTouched = useRef(false)
  const [mCost, setMCost] = useState('FREE')
  const [mLic, setMLic] = useState('VERIFIED_COMMERCIAL')
  const [mPriority, setMPriority] = useState('100')
  const [showModelCustom, setShowModelCustom] = useState(false)
  const [testResult, setTestResult] = useState<Record<string, { state: string; note?: string; error?: string; mock?: boolean }>>({})

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['providers'] })
    qc.invalidateQueries({ queryKey: ['models'] })
  }

  const submitProv = async () => {
    if (!pName.trim() || provBusy) return
    setProvBusy(true)
    setProvError(null)
    try {
      const res = await api.createProvider({
        name: pName.trim(), base_url: pUrl.trim(), adapter_key: pAdapter,
      })
      const key = newKey.trim()
      if (key) await api.saveCredential(res.data.id, key)
      setPName(''); setPUrl(''); setNewKey('')
      setCredFor(''); setCredSaved('')
      setShowAdd(false)
      refresh()
    } catch (e) {
      setProvError(e)
    } finally {
      setProvBusy(false)
    }
  }
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
      capabilities: expandCapabilities(mCap), cost_class: mCost, license_status: mLic,
      priority: Number(mPriority) || 100,
    }),
    onSuccess: () => { setMName(''); setMId(''); capTouched.current = false; refresh() },
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
  const modelsOf = (pid: string) => modelList.filter((m) => m.provider_id === pid)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mô hình AI"
        sub="Bạn dùng khoá API riêng · được mã hoá, không hiển thị lại"
        actions={
          providerList.length > 0 && !showAdd ? (
            <Btn variant="accent" onClick={() => setShowAdd(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Thêm nhà cung cấp
            </Btn>
          ) : undefined
        }
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
              className={`rounded-lg border px-3 py-2 ${step === s.n && !s.done ? 'border-accent bg-tint' : 'border-border bg-bg'}`}
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

      {/* Providers — mockup list: logo, info, model chips, status */}
      <div className="space-y-2.5">
        {providerList.length === 0 ? (
          <EmptyState icon="◇" title="Chưa có nhà cung cấp." hint="Thêm một dịch vụ OpenAI-compatible rồi lưu khoá của bạn." />
        ) : providerList.map((p) => {
          const logo = logoFor(p.name)
          const pModels = modelsOf(p.id)
          const resting = pModels.some((m) => ['QUOTA_EXHAUSTED', 'RATE_LIMITED'].includes(m.health_status))
          return (
            <div key={p.id}>
              <div className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-xl border border-border bg-surface p-4 transition-colors duration-hover hover:border-ink/30">
                <button
                  onClick={() => { setCredFor(p.id); setCredSaved('') }}
                  title={p.credential_configured ? 'Đổi khoá' : 'Nhập khoá'}
                  className="grid min-w-0 grid-cols-[44px_1fr_auto] items-center gap-4 text-left"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-11 w-11 items-center justify-center rounded-xl text-sm font-bold text-white"
                    style={{ background: logo.grad }}
                  >
                    {logo.initials}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{p.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {p.base_url || 'chưa có địa chỉ'} · {pModels.length} mô hình · khoá:{' '}
                      {p.credential_configured ? 'đã cấu hình' : 'chưa cấu hình'}
                    </span>
                  </span>
                  <span className="hidden flex-wrap justify-end gap-1 md:flex md:max-w-70">
                    {pModels.slice(0, 3).map((m) => (
                      <span key={m.id} className="badge badge-info">{m.name}</span>
                    ))}
                  </span>
                </button>
                <span className="flex shrink-0 flex-col items-end gap-1.5">
                  {p.credential_configured ? (
                    resting
                      ? <span className="badge badge-warn">Tạm nghỉ</span>
                      : <span className="badge badge-ok">Đã kết nối</span>
                  ) : (
                    <span className="badge badge-info">Chưa kết nối</span>
                  )}
                  <Btn variant="link" onClick={() => { setCredFor(p.id); setCredSaved('') }}>
                    {p.credential_configured ? 'Đổi khoá' : 'Nhập khoá'}
                  </Btn>
                </span>
              </div>
              {credFor === p.id ? (
                <div className="mt-2 rounded-xl border border-emberline bg-tint p-3">
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
            </div>
          )
        })}
      </div>

      {showAdd || providerList.length === 0 ? (
      <Card>
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <h2 className="section-title">Thêm nhà cung cấp</h2>
            {showAdd && providerList.length > 0 ? (
              <Btn variant="link" onClick={() => setShowAdd(false)}>Đóng</Btn>
            ) : null}
          </div>
          <p className="mb-2.5 text-[13px] text-secondary">{tr('ai.provider.what')}</p>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.09em] text-secondary">{tr('ai.preset.title')}</p>
          <div className="mb-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {PRESETS.map((preset) => {
              const logo = logoFor(preset.name)
              return (
                <button
                  key={preset.name}
                  onClick={() => { setPName(preset.name); setPUrl(preset.url); setPAdapter(preset.adapter) }}
                  className="flex items-center gap-2 rounded-lg border border-border bg-panel px-2.5 py-2 text-left transition-colors duration-hover hover:border-accent"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white"
                    style={{ background: logo.grad }}
                  >
                    {logo.initials}
                  </span>
                  <span className="truncate text-[12px] font-semibold">{preset.name}</span>
                </button>
              )
            })}
          </div>
          <p className="mb-2.5 text-[11px] text-muted">{tr('ai.preset.hint')}</p>
          <Field
            aria-label="Tên nhà cung cấp"
            value={pName}
            onChange={(e) => setPName(e.target.value)}
            placeholder="Tên, ví dụ: OpenRouter"
          />
          <div hidden={!showCustom}>
            <div className="space-y-2">
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
            </div>
          </div>
          <Field
            aria-label={tr('ai.key.inline')}
            type="password"
            autoComplete="off"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder={tr('ai.key.inline.ph')}
          />
          <div className="flex items-center justify-between gap-2">
            <Btn
              variant="accent"
              busy={provBusy}
              disabled={!pName.trim() || provBusy}
              onClick={() => void submitProv()}
              className="flex-1"
            >
              Thêm nhà cung cấp
            </Btn>
            <Btn variant="link" onClick={() => setShowCustom((s) => !s)}>
              {showCustom ? tr('ai.custom.less') : tr('ai.custom.more')}
            </Btn>
          </div>
          {provError ? (
            <ExplainError
              what="Không thêm được nhà cung cấp."
              error={provError}
              todo="Kiểm tra địa chỉ phải bắt đầu bằng https và không trỏ về máy cục bộ."
            />
          ) : null}
        </Card>
      ) : null}

      {/* Upstream free-tier quotas, mirrored read-only from local FreeLLMAPI. */}
      <Card>
        <h2 className="section-title mb-1">Hạn mức dùng</h2>
        <p className="mb-2.5 text-[13px] text-secondary">
          Số liệu từ bộ điều phối FreeLLMAPI trên máy này. Nhà cung cấp không công bố hạn mức thì ghi “không rõ”, không bịa số.
        </p>
        {!quotas.data ? (
          <p className="text-[13px] text-muted">Chưa đọc được hạn mức.</p>
        ) : !quotas.data.data.reachable ? (
          <p className="text-[13px] text-muted">FreeLLMAPI chưa chạy nên chưa có số hạn mức.</p>
        ) : (
          <ul className="space-y-2">
            {quotas.data.data.providers.map((q) => {
              const cooling = q.cooldowns.length > 0
              return (
                <li key={q.platform} className="rounded-lg border border-border bg-panel px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold capitalize">{q.platform}</p>
                    <span className={`badge ${q.key_status === 'healthy' ? 'badge-ok' : q.key_status === 'rate_limited' || cooling ? 'badge-warn' : 'badge-info'}`}>
                      {q.key_status === 'healthy' && !cooling ? 'Khoá tốt'
                        : q.key_status === 'rate_limited' || cooling ? 'Đang nghỉ do giới hạn'
                        : q.key_status === 'invalid' ? 'Khoá lỗi'
                        : q.key_status}
                    </span>
                    <span className="mono ml-auto text-muted">
                      24h: {q.usage_24h.requests} lượt · {q.usage_24h.tokens.toLocaleString('vi-VN')} token
                    </span>
                  </div>
                  {q.cooldowns.length > 0 ? (
                    <p className="mono mt-1 text-muted">
                      Nghỉ tới: {q.cooldowns.map((c) => `${c.model} (${new Date(c.until_ms).toLocaleTimeString('vi-VN')})`).join(' · ')}
                    </p>
                  ) : null}
                  {q.quotas.filter((l) => l.limit != null || l.remaining != null).map((l, i) => (
                    <p key={i} className="mono mt-1 text-muted">
                      {l.pool ?? ''} {l.metric ?? ''}: còn {l.remaining ?? '?'} / {l.limit ?? '?'}
                      {l.reset_at ? ` · hồi ${l.reset_at}` : ''}
                    </p>
                  ))}
                  {q.quotas.every((l) => l.limit == null && l.remaining == null) ? (
                    <p className="mt-1 text-[12px] text-muted">Hạn mức còn lại: không rõ (nhà cung cấp không công bố).</p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="section-title mb-1">Mô hình ({modelList.length})</h2>
        <p className="mb-2.5 text-[13px] text-secondary">{tr('ai.model.what')}</p>
        {modelList.length === 0 ? (
          <EmptyState icon="◇" title="Chưa có mô hình nào." hint="Thêm mô hình cùng năng lực, chi phí và giấy phép để bộ định tuyến dùng được." />
        ) : (
          <ul className="space-y-1.5">
            {modelList.map((m) => {
              const t = testResult[m.id]
              const blocked = blockedReasons(m.cost_class, m.license_status)
              const use = usage.data?.data.by_model?.find((u) => u.model === m.name)
              const okRate = use && use.count > 0 ? Math.round(((use.successful ?? 0) / use.count) * 100) : null
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
                  <p className="mono mt-1 text-muted">
                    {use
                      ? `Đã dùng ${use.count} · thành công ${okRate ?? 0}% · TB ${use.avg_latency_ms ?? 0}ms${use.last_used_at ? ` · mới nhất ${use.last_used_at.slice(0, 16).replace('T', ' ')}` : ''}`
                      : 'Chưa phát sinh lượt gọi nào được ghi nhận.'}
                  </p>
                  {blocked.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 text-[12px] text-warn">
                      {blocked.map((b) => <li key={b}>Bị chặn: {b}</li>)}
                    </ul>
                  ) : null}
                  {t ? (
                    <p className="mt-1 text-xs text-ember">
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
                  <p className="mt-1 text-[11px] text-muted">{tr('ai.test.what')}</p>
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
            <Field
              aria-label="Mã mô hình"
              value={mId}
              onChange={(e) => {
                const v = e.target.value
                setMId(v)
                if (!capTouched.current) {
                  const g = guessCapabilities(v, mName)
                  if (g[0] !== mCap) setMCap(g[0])
                }
              }}
              placeholder="mã gửi tới nhà cung cấp"
            />
          </div>
          <div className="rounded-lg border border-border bg-panel px-3 py-2">
            <p className="text-[13px]">
              <span className="text-muted">Web tự nhận năng lực: </span>
              <span className="font-semibold">
                {expandCapabilities(mCap).map((c) => CAPS[c] ?? c).join(' + ')}
              </span>{' '}
              <Btn variant="link" onClick={() => setShowCapSelect((s) => !s)}>
                {showCapSelect ? 'ẩn' : 'đổi'}
              </Btn>
            </p>
            <div hidden={!showCapSelect} className="mt-2">
              <Select
                aria-label="Năng lực"
                value={mCap}
                onChange={(e) => { capTouched.current = true; setMCap(e.target.value) }}
              >
                {Object.entries(CAPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
          </div>
          <div hidden={!showModelCustom}>
            <div className="grid gap-2 sm:grid-cols-3">
              <Select aria-label="Lớp chi phí" value={mCost} onChange={(e) => setMCost(e.target.value)}>
                {COST_CLASSES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
              </Select>
              <Select aria-label="Giấy phép" value={mLic} onChange={(e) => setMLic(e.target.value)}>
                {LICENSES.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
              </Select>
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
            </div>
          </div>
          {warnings.length > 0 ? (
            <ul className="space-y-0.5 rounded-lg border border-emberline bg-tint p-2.5 text-[12px] text-warn">
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          ) : null}
          <div className="flex items-center gap-2">
            <Btn
              variant="accent"
              busy={createModel.isPending}
              disabled={!mProvider || !mName.trim() || createModel.isPending}
              onClick={() => createModel.mutate()}
              className="flex-1"
            >
              Thêm mô hình
            </Btn>
            <Btn variant="link" onClick={() => setShowModelCustom((s) => !s)}>
              {showModelCustom ? tr('ai.custom.less') : tr('ai.custom.more')}
            </Btn>
          </div>
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
  )
}

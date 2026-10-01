import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { EmptyState, ErrorState, LoadingState } from '../components/states'

const CAPS = ['TEXT', 'STORY', 'VISION', 'IMAGE', 'VIDEO', 'TTS', 'MUSIC', 'SFX', 'EMBEDDING']
const COSTS = ['LOCAL', 'FREE', 'FREE_WITH_LIMIT', 'TRIAL', 'PAID', 'UNKNOWN']
const LICENSES = ['VERIFIED_COMMERCIAL', 'VERIFIED_NONCOMMERCIAL', 'UNKNOWN', 'UNVERIFIED']

export function AiModelsPage() {
  const qc = useQueryClient()
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers })
  const models = useQuery({ queryKey: ['models'], queryFn: api.models })
  const [pName, setPName] = useState('')
  const [pUrl, setPUrl] = useState('')
  const [credFor, setCredFor] = useState('')
  const [credSecret, setCredSecret] = useState('')
  const [mProvider, setMProvider] = useState('')
  const [mName, setMName] = useState('')
  const [mId, setMId] = useState('')
  const [mCap, setMCap] = useState('TEXT')
  const [testResult, setTestResult] = useState<Record<string, string>>({})

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['providers'] })
    qc.invalidateQueries({ queryKey: ['models'] })
  }

  const createProv = useMutation({
    mutationFn: () => api.createProvider({ name: pName, base_url: pUrl || undefined, adapter_key: 'custom' }),
    onSuccess: () => { setPName(''); setPUrl(''); refresh() },
  })
  const saveCred = useMutation({
    mutationFn: () => api.saveCredential(credFor, credSecret),
    onSuccess: () => { setCredSecret(''); setCredFor(''); refresh() },
  })
  const createModel = useMutation({
    mutationFn: () => api.createModel({
      provider_id: mProvider, name: mName, model_id: mId || mName,
      capabilities: [mCap], cost_class: 'UNKNOWN', license_status: 'UNVERIFIED',
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
    try {
      const res = await api.testModel(id, mCap)
      setTestResult((s) => ({ ...s, [id]: `${res.data.state}${res.data.mock ? ' (mock)' : ''}` }))
    } catch (e) {
      setTestResult((s) => ({ ...s, [id]: `FAILED: ${(e as Error).message}` }))
    }
    qc.invalidateQueries({ queryKey: ['models'] })
  }

  if (providers.isPending || models.isPending) return <LoadingState />
  if (providers.isError) return <ErrorState message={(providers.error as Error).message} onRetry={() => providers.refetch()} />
  if (models.isError) return <ErrorState message={(models.error as Error).message} onRetry={() => models.refetch()} />

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">AI Model Center</h1>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Providers ({providers.data!.data.length})</h2>
        {providers.data!.data.length === 0 ? <EmptyState title="Chưa có provider. Thêm provider đầu tiên để bắt đầu." /> : (
          <ul className="grid gap-2 md:grid-cols-2">
            {providers.data!.data.map((p) => (
              <li key={p.id} className="rounded border border-border bg-surface p-3 text-sm">
                <p className="font-semibold text-ink">{p.name} <span className="text-xs text-muted">{p.adapter_key}</span></p>
                <p className="text-xs text-secondary">Health: {p.health} · Credential: {p.credential_configured ? 'configured' : 'NOT_CONFIGURED'}</p>
                <button className="mt-2 text-xs text-accent" onClick={() => setCredFor(p.id)}>Nhập API key</button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <input aria-label="Provider name" value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Tên provider"
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm" />
          <input aria-label="Base URL" value={pUrl} onChange={(e) => setPUrl(e.target.value)} placeholder="https://... (trống nếu chưa có)"
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm" />
          <button disabled={!pName || createProv.isPending} onClick={() => createProv.mutate()}
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50">Thêm provider</button>
        </div>
        {credFor ? (
          <div className="flex flex-wrap items-center gap-2 rounded border border-border p-3">
            <span className="text-xs text-secondary">API key cho provider (không hiển thị lại sau khi lưu):</span>
            <input aria-label="API secret" type="password" value={credSecret} onChange={(e) => setCredSecret(e.target.value)}
              placeholder="sk-..." className="rounded border border-border bg-bg px-2 py-1.5 text-sm" />
            <button disabled={!credSecret || saveCred.isPending} onClick={() => saveCred.mutate()}
              className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50">Lưu key</button>
            <button className="text-xs text-muted" onClick={() => { setCredFor(''); setCredSecret('') }}>Huỷ</button>
          </div>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Models ({models.data!.data.length})</h2>
        {models.data!.data.length === 0 ? <EmptyState title="Chưa có model." /> : (
          <ul className="grid gap-2 md:grid-cols-2">
            {models.data!.data.map((m) => (
              <li key={m.id} className="rounded border border-border bg-surface p-3 text-sm">
                <p className="font-semibold text-ink">{m.name} <span className="text-xs text-muted">{m.enabled ? 'ON' : 'OFF'}</span></p>
                <p className="text-xs text-secondary">{m.capabilities.join(', ')} · Prio {m.priority} · {m.cost_class} · {m.license_status} · {m.health_status}</p>
                {testResult[m.id] ? <p className="text-xs text-accent">Test: {testResult[m.id]}</p> : null}
                <div className="mt-2 flex gap-3 text-xs">
                  <button className="text-accent" onClick={() => toggleModel.mutate(m)}>{m.enabled ? 'Disable' : 'Enable'}</button>
                  <button className="text-accent" onClick={() => runTest(m.id)}>Test</button>
                  <button className="text-muted" onClick={() => deleteModel.mutate(m.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <select aria-label="Model provider" value={mProvider} onChange={(e) => setMProvider(e.target.value)}
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm">
            <option value="">— Provider —</option>
            {providers.data!.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input aria-label="Model name" value={mName} onChange={(e) => setMName(e.target.value)} placeholder="Tên model"
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm" />
          <input aria-label="Model ID" value={mId} onChange={(e) => setMId(e.target.value)} placeholder="model-id"
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm" />
          <select aria-label="Capability" value={mCap} onChange={(e) => setMCap(e.target.value)}
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm">
            {CAPS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button disabled={!mProvider || !mName || createModel.isPending} onClick={() => createModel.mutate()}
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50">Thêm model</button>
        </div>
        <p className="text-xs text-muted">Cost mặc định UNKNOWN + License UNVERIFIED → bị policy block cho tới khi bạn cập nhật. Xem COSTS: {COSTS.join('/')} · LICENSES: {LICENSES.join('/')}</p>
      </section>
    </div>
  )
}

import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import type { TraceStep } from '../api/client'
import { EmptyState, ErrorState, LoadingState } from '../components/states'

export function AiRouterPage() {
  const [cap, setCap] = useState('TEXT')
  const [strategy, setStrategy] = useState('AUTO')
  const [prompt, setPrompt] = useState('Xin chào')
  const [result, setResult] = useState<{ output?: string; error?: { code: string; message: string }; trace: TraceStep[] } | null>(null)

  const eligible = useQuery({ queryKey: ['eligible', cap], queryFn: () => api.routerEligible(cap) })
  const activity = useQuery({ queryKey: ['activity'], queryFn: api.activity })
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
    <div className="space-y-6">
      <h1 className="text-xl font-bold">AI Router</h1>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Chiến lược + Policy</h2>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Strategy" value={strategy} onChange={(e) => setStrategy(e.target.value)}
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm">
            {['AUTO', 'PRIORITY', 'WEIGHTED', 'FASTEST', 'CHEAPEST'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select aria-label="Capability" value={cap} onChange={(e) => setCap(e.target.value)}
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm">
            {['TEXT', 'STORY', 'VISION', 'IMAGE', 'VIDEO', 'TTS', 'MUSIC', 'SFX', 'EMBEDDING'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input aria-label="Prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)}
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm" />
          <button disabled={generate.isPending} onClick={() => generate.mutate()}
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50">Chạy thử router</button>
        </div>
        {result ? (
          <div className="rounded border border-border bg-surface p-3 text-sm">
            {result.output ? <p className="text-ink">Output: {result.output}</p> : null}
            {result.error ? <p className="text-accent">{result.error.code}: {result.error.message}</p> : null}
            <p className="mt-2 text-xs text-muted">Trace:</p>
            {result.trace.length === 0 ? <p className="text-xs text-muted">(blocked trước network — không có attempt)</p> : (
              <ol className="text-xs text-secondary">
                {result.trace.map((t) => (
                  <li key={t.attempt}>#{t.attempt} {t.provider}/{t.model} — {t.status}{t.error_code !== 'SUCCESS' ? ` ${t.error_code}` : ''}{t.fallback_reason ? ` → ${t.fallback_reason}` : ''} ({t.latency_ms}ms)</li>
                ))}
              </ol>
            )}
          </div>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Eligible Models</h2>
        {eligible.isPending ? <LoadingState /> : null}
        {eligible.isError ? <ErrorState message={(eligible.error as Error).message} onRetry={() => eligible.refetch()} /> : null}
        {eligible.data ? (
          <div className="text-sm">
            <p className="text-xs text-muted">Resolved: {eligible.data.data.strategy_resolved}</p>
            {eligible.data.data.eligible.length === 0 ? <EmptyState title="Không có model đủ điều kiện." /> : (
              <ul className="mt-2 grid gap-2 md:grid-cols-2">
                {eligible.data.data.eligible.map((m) => (
                  <li key={m.id} className="rounded border border-border bg-surface p-3 text-sm">{m.name} · Prio {m.priority}</li>
                ))}
              </ul>
            )}
            {eligible.data.data.excluded.length > 0 ? (
              <ul className="mt-2 text-xs text-muted">
                {eligible.data.data.excluded.map((e, i) => <li key={i}>{e.model}: {e.reason}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Activity (mới nhất)</h2>
        {activity.data ? (
          <ul className="space-y-1 text-xs text-secondary">
            {activity.data.data.slice(0, 15).map((a, i) => (
              <li key={i}>{a.task} · {a.provider}/{a.model} · {a.status}{a.error_category ? ` ${a.error_category}` : ''} · {a.latency_ms}ms{a.mock ? ' · mock' : ''}</li>
            ))}
          </ul>
        ) : <p className="text-xs text-muted">Chưa có activity.</p>}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Usage</h2>
        {usage.data ? (
          <p className="text-sm text-secondary">
            Requests {usage.data.data.requests} · Success {usage.data.data.successful} ·
            Fallbacks {usage.data.data.fallbacks} · Cost {usage.data.data.cost_state}
          </p>
        ) : null}
      </section>
    </div>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { DirectorPlan } from '../api/client'
import { EmptyState, ErrorState, LoadingState } from '../components/states'

function DirectorError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const e = error as Error & { code?: string; requestId?: string }
  return (
    <div role="alert" className="rounded border border-border bg-surface p-4 text-sm">
      <p className="font-semibold text-ink">AI generation failed — đã xảy ra lỗi khi tạo Director Plan.</p>
      <p className="mt-1 text-secondary">
        Lý do: {e.code ?? 'UNKNOWN_ERROR'} — {e.message}
      </p>
      <p className="mt-1 text-secondary">Bạn có thể thử lại, đổi model, hoặc xem AI Activity.</p>
      {e.requestId ? <p className="mt-1 text-xs text-muted">request_id: {e.requestId}</p> : null}
      <div className="mt-3 flex gap-3 text-xs">
        <button className="rounded bg-accent px-3 py-1.5 font-semibold text-black" onClick={onRetry}>
          Thử lại
        </button>
        <Link className="px-1 py-1.5 text-accent" to="/ai/router">
          Xem AI Activity
        </Link>
      </div>
    </div>
  )
}

function PlanView({ plan, onAction }: { plan: DirectorPlan; onAction: (a: string, arg?: string) => void }) {
  const p = plan.plan
  const [editingTitle, setEditingTitle] = useState(false)
  const [title, setTitle] = useState(p.title)
  return (
    <div className="space-y-3 rounded border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-secondary">
          v{plan.version} · {plan.status} · {plan.origin} · {plan.provider}/{plan.model}
          {plan.mock ? ' · mock' : ''}
        </p>
        <p className="text-xs text-muted">req: {plan.request_id}</p>
      </div>
      {editingTitle ? (
        <div className="flex gap-2">
          <input
            aria-label="Sửa title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm"
          />
          <button
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-black"
            onClick={() => {
              onAction('edit', title)
              setEditingTitle(false)
            }}
          >
            Lưu
          </button>
        </div>
      ) : (
        <h2 className="text-lg font-bold">{p.title}</h2>
      )}
      {p.hook ? <p className="text-sm text-secondary">Hook: {p.hook}</p> : null}
      {p.concept ? <p className="text-sm">Concept: {p.concept}</p> : null}
      {p.scenes && p.scenes.length > 0 ? (
        <ol className="space-y-1 text-sm">
          {p.scenes.map((s) => (
            <li key={s.scene_number} className="rounded border border-border p-2">
              <span className="font-semibold">Scene {s.scene_number}</span> — {s.description}
              {s.dialogue ? <span className="text-secondary"> · “{s.dialogue}”</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      <div className="grid gap-1 text-xs text-secondary md:grid-cols-2">
        {p.visual_style ? <p>Visual: {p.visual_style}</p> : null}
        {p.voice_style ? <p>Voice: {p.voice_style}</p> : null}
        {p.duration ? <p>Duration: {String(p.duration)}s</p> : null}
        {p.ending ? <p>Ending: {p.ending}</p> : null}
        {p.cta ? <p>CTA: {p.cta}</p> : null}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {plan.status === 'REVIEW' ? (
          <>
            <button className="rounded bg-accent px-3 py-1.5 font-semibold text-black" onClick={() => onAction('approve')}>
              Approve
            </button>
            <button className="text-accent" onClick={() => onAction('reject')}>
              Reject
            </button>
          </>
        ) : null}
        <button className="text-accent" onClick={() => setEditingTitle(!editingTitle)}>
          Edit
        </button>
        <button className="text-accent" onClick={() => onAction('regenerate')}>
          Regenerate
        </button>
        <button className="text-accent" onClick={() => onAction('section', 'hook')}>
          Regenerate hook
        </button>
      </div>
    </div>
  )
}

export function StoryDetailPage() {
  const { projectId } = useParams()
  const qc = useQueryClient()
  const [idea, setIdea] = useState('')
  const [audience, setAudience] = useState('kids 6-9')
  const [tone, setTone] = useState('vui vẻ')
  const [charName, setCharName] = useState('')

  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => api.project(projectId!) })
  const plans = useQuery({ queryKey: ['plans', projectId], queryFn: () => api.plans(projectId!) })
  const characters = useQuery({ queryKey: ['characters', projectId], queryFn: () => api.characters(projectId!) })
  const scenes = useQuery({ queryKey: ['scenes', projectId], queryFn: () => api.scenes(projectId!) })

  const refreshPlans = () => qc.invalidateQueries({ queryKey: ['plans', projectId] })

  const generate = useMutation({
    mutationFn: () =>
      api.generatePlan(projectId!, {
        idea,
        audience,
        tone,
        duration: project.data?.data.duration_target ?? 30,
        language: project.data?.data.language ?? 'vi',
        style: project.data?.data.style ?? '',
        character_ids: (characters.data?.data ?? []).map((c) => c.id),
      }),
    onSuccess: () => {
      setIdea('')
      refreshPlans()
    },
  })

  const act = (planId: string, a: string, arg?: string) => {
    const run = async () => {
      if (a === 'approve') await api.approvePlan(planId)
      else if (a === 'reject') await api.rejectPlan(planId)
      else if (a === 'regenerate') await api.regeneratePlan(planId, {})
      else if (a === 'section') await api.regenerateSection(planId, arg ?? 'hook')
      else if (a === 'edit') {
        const current = plans.data?.data.find((x) => x.id === planId)
        if (current) await api.editPlan(planId, { ...current.plan, title: arg ?? current.plan.title })
      }
      refreshPlans()
    }
    run().catch(() => refreshPlans())
  }

  const addChar = useMutation({
    mutationFn: () => api.createCharacter(projectId!, { name: charName, kind: 'MAIN' }),
    onSuccess: () => {
      setCharName('')
      qc.invalidateQueries({ queryKey: ['characters', projectId] })
    },
  })

  if (project.isPending) return <LoadingState />
  if (project.isError)
    return <ErrorState message={(project.error as Error).message} onRetry={() => project.refetch()} />

  const latest = plans.data?.data[plans.data.data.length - 1]

  return (
    <div className="space-y-5">
      <Link to="/story" className="text-xs text-accent">
        ← Story Factory
      </Link>
      <h1 className="text-xl font-bold">{project.data.data.name}</h1>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Nhân vật ({characters.data?.data.length ?? '…'})</h2>
        <ul className="flex flex-wrap gap-2 text-xs">
          {(characters.data?.data ?? []).map((c) => (
            <li key={c.id} className="rounded border border-border bg-surface px-2 py-1">
              {c.name} · {c.lock_state}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            aria-label="Tên nhân vật"
            value={charName}
            onChange={(e) => setCharName(e.target.value)}
            placeholder="Tên nhân vật..."
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm"
          />
          <button
            disabled={!charName || addChar.isPending}
            onClick={() => addChar.mutate()}
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
          >
            Thêm
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">AI Director</h2>
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="Ý tưởng"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="Ý tưởng story..."
            className="min-w-52 flex-1 rounded border border-border bg-bg px-2 py-1.5 text-sm"
          />
          <input
            aria-label="Khán giả"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm"
          />
          <input
            aria-label="Tone"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm"
          />
          <button
            disabled={!idea || generate.isPending}
            onClick={() => generate.mutate()}
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
          >
            Tạo Director Plan
          </button>
        </div>
        {generate.isError ? <DirectorError error={generate.error} onRetry={() => generate.mutate()} /> : null}
        {plans.isPending ? <LoadingState /> : null}
        {plans.data && plans.data.data.length === 0 && !generate.isPending ? (
          <EmptyState title="Chưa có Director Plan. Nhập ý tưởng để AI lập kế hoạch." />
        ) : null}
        {latest ? <PlanView plan={latest} onAction={(a, arg) => act(latest.id, a, arg)} /> : null}
        {plans.data && plans.data.data.length > 1 ? (
          <p className="text-xs text-muted">
            Lịch sử: {plans.data.data.map((p) => `v${p.version} ${p.status}`).join(' · ')}
          </p>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Scenes ({scenes.data?.data.length ?? '…'})</h2>
        {(scenes.data?.data ?? []).map((s) => (
          <SceneRow key={s.id} projectId={projectId!} scene={s} />
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Render / QC / Export / Automation</h2>
        <ProjectMedia projectId={projectId!} />
      </section>
    </div>
  )
}

function SceneRow({ projectId, scene }: { projectId: string; scene: { id: string; order: number; description: string; status: string } }) {
  const qc = useQueryClient()
  const arts = useQuery({ queryKey: ['artifacts', scene.id], queryFn: () => api.sceneArtifacts(projectId, scene.id) })
  const [msg, setMsg] = useState('')
  const run = async (fn: () => Promise<unknown>) => {
    setMsg('Đang chạy...')
    try {
      await fn()
      setMsg('')
    } catch (e) {
      const err = e as Error & { code?: string; requestId?: string }
      setMsg(`${err.code ?? 'ERROR'}: ${err.message} (${err.requestId ?? 'no-req'})`)
    }
    qc.invalidateQueries({ queryKey: ['artifacts', scene.id] })
  }
  const kinds = (arts.data?.data ?? []).map((a) => a.kind).join(', ')
  return (
    <div className="rounded border border-border bg-surface p-2 text-sm">
      <p>
        #{scene.order} {scene.description || '(chưa có mô tả)'} · {scene.status}
      </p>
      <p className="text-xs text-muted">Media: {kinds || 'chưa có'}</p>
      <div className="mt-1 flex flex-wrap gap-2 text-xs">
        <button className="text-accent" onClick={() => run(() => api.genSceneMedia(projectId, scene.id, 'image'))}>Image</button>
        <button className="text-accent" onClick={() => run(() => api.genSceneMedia(projectId, scene.id, 'tts'))}>TTS</button>
        <button className="text-accent" onClick={() => run(() => api.genSubtitle(projectId, scene.id))}>Subtitle</button>
        <button className="text-accent" onClick={() => run(() => api.renderScene(projectId, scene.id))}>Render</button>
      </div>
      {msg ? <p className="text-xs text-accent">{msg}</p> : null}
    </div>
  )
}

function ProjectMedia({ projectId }: { projectId: string }) {
  const [msg, setMsg] = useState('')
  const [qc, setQc] = useState('')
  const run = async (fn: () => Promise<{ request_id: string; data: unknown }>, label: string) => {
    setMsg(`${label}...`)
    try {
      const res = await fn()
      setMsg(`${label}: OK (${res.request_id})`)
    } catch (e) {
      const err = e as Error & { code?: string; requestId?: string }
      setMsg(`${label}: ${err.code ?? 'ERROR'} — ${err.message}`)
    }
  }
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap gap-3 text-xs">
        <button className="rounded bg-accent px-3 py-1.5 font-semibold text-black" onClick={() => run(() => api.renderProject(projectId), 'Render')}>
          Render project
        </button>
        <button
          className="text-accent"
          onClick={async () => {
            setQc('Đang kiểm tra...')
            try {
              const res = await api.runQC(projectId)
              setQc(`QC ${res.data.qc.verdict} · Gate ${res.data.gate.decision}${res.data.gate.reasons.length ? `: ${res.data.gate.reasons.join('; ')}` : ''}`)
            } catch (e) {
              setQc(`QC lỗi: ${(e as Error).message}`)
            }
          }}
        >
          Chạy QC
        </button>
        <button className="text-accent" onClick={() => run(() => api.exportProject(projectId), 'Export')}>
          Export
        </button>
        <button
          className="text-accent"
          onClick={() => run(() => api.createJob(projectId).then((r) => ({ request_id: r.request_id, data: r.data })), 'Automation')}
        >
          Chạy automation
        </button>
      </div>
      {qc ? <p className="text-xs text-secondary">{qc}</p> : null}
      {msg ? <p className="text-xs text-secondary">{msg}</p> : null}
    </div>
  )
}

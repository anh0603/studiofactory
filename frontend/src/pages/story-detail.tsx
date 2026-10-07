import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Info, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { DirectorPlan } from '../api/client'
import { ErrorState, LoadingList } from '../components/states'
import { NextActionBar } from '../components/next-action'
import { VideoPlayer } from '../components/player'
import { Card, Field, PageHeader, StatusBadge, Btn } from '../components/ui'
import { WorkflowStepper, WorkflowStrip } from '../components/workflow'
import { resolveNextAction, resolveWorkflow } from '../story/workflow'
import type { QcResultLite, StepId, WorkflowInput } from '../story/workflow'
import { Workspace } from '../story/workspaces'

export function StoryDetailPage() {
  const { projectId } = useParams()
  const qcClient = useQueryClient()
  const [activeStep, setActiveStep] = useState<StepId>('DIRECTOR')
  const [busyStep, setBusyStep] = useState<StepId | null>(null)
  const [sceneForm] = useState({ audience: 'trẻ em 6-9 tuổi', tone: 'vui vẻ' })
  // QC is POST-only and not persisted server-side, so it lives in this component only.
  const [qcResult, setQcResult] = useState<QcResultLite | null>(null)

  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => api.project(projectId!) })
  const plans = useQuery({ queryKey: ['plans', projectId], queryFn: () => api.plans(projectId!) })
  const characters = useQuery({ queryKey: ['characters', projectId], queryFn: () => api.characters(projectId!) })
  const scenes = useQuery({ queryKey: ['scenes', projectId], queryFn: () => api.scenes(projectId!) })
  // One project-level artifact request, filtered client-side. No N-per-scene calls.
  const artifacts = useQuery({ queryKey: ['artifacts', projectId], queryFn: () => api.sceneArtifactsAll(projectId!) })
  const schedules = useQuery({ queryKey: ['schedules', projectId], queryFn: () => api.schedules(projectId!) })
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api.jobs(), refetchInterval: 4000 })
  const apRuns = useQuery({ queryKey: ['apruns', projectId], queryFn: () => api.apRuns(projectId!), retry: false })

  const projectJobs = (jobs.data?.data ?? []).filter((j) => j.project_id === projectId)
  const firstLive = projectJobs.find((j) => j.status === 'RUNNING' || j.status === 'QUEUED' || j.status === 'RETRY_QUEUED')
  const liveJob = useQuery({
    queryKey: ['job', firstLive?.id],
    queryFn: () => api.job(firstLive!.id),
    enabled: !!firstLive,
    refetchInterval: 2000,
  })

  const refresh = () => {
    qcClient.invalidateQueries({ queryKey: ['plans', projectId] })
    qcClient.invalidateQueries({ queryKey: ['scenes', projectId] })
    qcClient.invalidateQueries({ queryKey: ['artifacts', projectId] })
    qcClient.invalidateQueries({ queryKey: ['jobs'] })
  }
  const refreshSchedules = () => qcClient.invalidateQueries({ queryKey: ['schedules', projectId] })

  const generate = useMutation({
    mutationFn: (body: { idea: string; audience: string; tone: string }) =>
      api.generatePlan(projectId!, {
        idea: body.idea,
        audience: body.audience,
        tone: body.tone,
        duration: project.data?.data.duration_target ?? 30,
        language: project.data?.data.language ?? 'vi',
        style: project.data?.data.style ?? '',
        character_ids: (characters.data?.data ?? []).map((c) => c.id),
      }),
    onSuccess: refresh,
  })

  const [planActing, setPlanActing] = useState(false)
  const act = (planId: string, a: string, arg?: string) => {
    setPlanActing(true)
    const run = async () => {
      if (a === 'approve') await api.approvePlan(planId)
      else if (a === 'reject') await api.rejectPlan(planId)
      else if (a === 'regenerate') await api.regeneratePlan(planId, {})
      else if (a === 'section') await api.regenerateSection(planId, arg ?? 'hook')
      else if (a === 'edit') {
        const current = plans.data?.data.find((x) => x.id === planId)
        if (current) await api.editPlan(planId, { ...current.plan, title: arg ?? current.plan.title })
      }
      refresh()
    }
    run().catch(() => refresh()).finally(() => setPlanActing(false))
  }

  const addChar = useMutation({
    mutationFn: (name: string) => api.createCharacter(projectId!, { name, kind: 'MAIN' }),
    onSuccess: () => { qcClient.invalidateQueries({ queryKey: ['characters', projectId] }) },
  })

  const addScene = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.createScene(projectId!, body),
    onSuccess: refresh,
  })

  const runQc = useMutation({
    mutationFn: () => api.runQC(projectId!),
    onSuccess: (res) => setQcResult(res.data as unknown as QcResultLite),
  })

  const addSchedule = useMutation({
    mutationFn: (body: { date: string; time: string; platforms: string[] }) =>
      api.createSchedule(projectId!, {
        date: body.date, time: body.time, timezone: 'Asia/Ho_Chi_Minh',
        platforms: body.platforms, idempotency_key: `ui-${projectId}-${body.date}-${body.time}`,
      }),
    onSuccess: refreshSchedules,
  })

  const saveProject = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.updateProject(projectId!, body),
    onSuccess: () => qcClient.invalidateQueries({ queryKey: ['project', projectId] }),
  })

  if (project.isPending) return <LoadingList rows={5} />
  if (project.isError)
    return <ErrorState message={(project.error as Error).message} onRetry={() => project.refetch()} />

  const p = project.data.data
  const planList: DirectorPlan[] = plans.data?.data ?? []
  const sceneList = scenes.data?.data ?? []
  const artList = artifacts.data?.data ?? []

  const wfInput: WorkflowInput = {
    project: { description: p.description, status: p.status, duration_target: p.duration_target, language: p.language, updated_at: p.updated_at },
    plans: planList,
    characters: characters.data?.data ?? [],
    scenes: sceneList,
    artifacts: artList,
    schedules: schedules.data?.data ?? [],
    activeNodes: liveJob.data?.data.nodes ?? [],
    qc: qcResult,
    autopilot: apRuns.data?.data.find((r) => r.status === 'RUNNING') ?? null,
  }
  const nodes = resolveWorkflow(wfInput)
  const next = resolveNextAction(wfInput)

  const plan = planList.length ? planList.reduce((a, b) => (b.version > a.version ? b : a)) : null
  const finalVideo = artList.find((a) => a.kind === 'VIDEO' && !a.scene_id) ?? null

  const onIntent = (intent: string) => {
    setActiveStep(next.step)
    if (intent === 'APPROVE_PLAN' && plan) act(plan.id, 'approve')
    else if (intent === 'REJECT_PLAN' && plan) act(plan.id, 'reject')
    else if (intent === 'REGENERATE_PLAN' && plan) act(plan.id, 'regenerate')
    else if (intent === 'RUN_QC') runQc.mutate()
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={p.name}
        sub={`${p.audience || 'chưa rõ'} · ${p.duration_target} giây · ${p.language}`}
        actions={<StatusBadge value={p.status} raw={false} />}
      />

      <div className="hidden md:block">
        <WorkflowStrip nodes={nodes} activeStep={activeStep} nextStep={next.step} onSelect={setActiveStep} />
      </div>
      <div className="md:hidden">
        <WorkflowStepper nodes={nodes} activeStep={activeStep} nextStep={next.step} onSelect={setActiveStep} />
      </div>

      <NextActionBar action={next} onIntent={onIntent} />

      <div className="grid items-start gap-4 lg:grid-cols-4">
        <div className="lg:col-span-3">
          {finalVideo ? (
            <div className="mb-4">
              <VideoPlayer
                src={api.artifactUrl(finalVideo.id)}
                title="Video hoàn thành"
                downloadName="final.mp4"
              />
            </div>
          ) : null}
          <Workspace
            activeStep={activeStep}
            project={p}
            saveProject={(body) => saveProject.mutate(body)}
            saveProjectPending={saveProject.isPending}
            saveProjectError={saveProject.isError ? (saveProject.error as Error).message : null}
            retrySaveProject={() => saveProject.reset()}
            projectId={projectId!}
            scenes={sceneList}
            artifacts={artList}
            plans={planList}
            characters={characters.data?.data ?? []}
            schedules={schedules.data?.data ?? []}
            qc={qcResult}
            busyStep={busyStep}
            onStepBusy={setBusyStep}
            onRefresh={refresh}
            onStep={setActiveStep}
            act={act}
            planActing={planActing}
            createPlan={(body) =>
              generate.mutate({ ...body, audience: body.audience || sceneForm.audience, tone: body.tone || sceneForm.tone })
            }
            planPending={generate.isPending}
            planError={generate.isError ? (generate.error as Error).message : null}
            onRetryPlan={() => generate.reset()}
            runQc={() => runQc.mutate()}
            qcPending={runQc.isPending}
            qcError={runQc.isError ? (runQc.error as Error).message : null}
            addCharacter={(name) => addChar.mutate(name)}
            characterPending={addChar.isPending}
            genMedia={async (sceneId, kind) => { await api.genSceneMedia(projectId!, sceneId, kind); refresh() }}
            genSubtitle={async (sceneId) => { await api.genSubtitle(projectId!, sceneId); refresh() }}
            renderScene={async (sceneId) => { await api.renderScene(projectId!, sceneId); refresh() }}
            renderProject={async () => { await api.renderProject(projectId!); refresh() }}
            exportProject={async () => {
              const r = await api.exportProject(projectId!)
              const files = Object.keys(r.data.manifest.files ?? {})
              return files.length ? files.join(', ') : r.request_id
            }}
            createScene={(body) => addScene.mutate(body)}
            scenePending={addScene.isPending}
            createSchedule={(body) => addSchedule.mutate(body)}
            schedulePending={addSchedule.isPending}
            cancelSchedule={(id) => { api.cancelSchedule(id).then(refreshSchedules, () => undefined) }}
          />
        </div>

        <Card className="lg:col-span-1">
          <h2 className="section-title mb-2.5 flex items-center gap-2">
            <Info className="h-4 w-4 text-accent" aria-hidden="true" />
            Thông tin dự án
          </h2>
          <dl className="space-y-1.5 text-[13px]">
            <div className="flex justify-between gap-2"><dt className="text-muted">Trạng thái</dt><dd><StatusBadge value={p.status} raw={false} /></dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted">Thời lượng</dt><dd className="text-secondary">{p.duration_target}s</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted">Cập nhật</dt><dd className="text-secondary">{p.updated_at ? new Date(p.updated_at).toLocaleString('vi-VN') : '—'}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted">Nhân vật</dt><dd className="text-secondary">{characters.data?.data.length ?? 0}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted">Cảnh</dt><dd className="text-secondary">{sceneList.length}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted">Đầu ra</dt><dd className="text-secondary">{outputLabel(artList)}</dd></div>
          </dl>
          <div className="mt-3 border-t border-border pt-3">
            <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.09em] text-secondary">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              Nhân vật
            </h3>
            <ul className="space-y-1">
              {(characters.data?.data ?? []).map((c) => (
                <li key={c.id} className="flex items-center gap-2 rounded-lg border border-border bg-bg px-2.5 py-1.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-elevated text-[12px] font-bold text-accent" aria-hidden="true">
                    {c.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{c.name}</p>
                    <div className="mt-0.5"><StatusBadge value={c.lock_state} raw={false} /></div>
                  </div>
                </li>
              ))}
            </ul>
            {characters.data && characters.data.data.length > 0 ? (
              <button
                type="button"
                onClick={() => setActiveStep('SCENES')}
                className="mt-2 text-[12px] text-accent hover:underline"
              >
                Quản lý hình mẫu và khoá
              </button>
            ) : null}
          </div>
        </Card>
      </div>

      <AutoPilotFooter run={wfInput.autopilot} runs={apRuns.data?.data ?? []} />

      {jobs.isError ? (
        <ErrorState message={`Không tải được hàng đợi: ${(jobs.error as Error).message}`} onRetry={() => jobs.refetch()} />
      ) : null}
    </div>
  )
}

function outputLabel(artifacts: { kind: string; scene_id?: string | null; width?: number | null; height?: number | null }[]): string {
  const out = artifacts.find((a) => a.kind === 'VIDEO' && !a.scene_id)
  return out ? `${out.width}×${out.height}` : '—'
}

function AutoPilotFooter({ run, runs }: { run: WorkflowInput['autopilot']; runs: { id: string; status: string }[] }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface/40 px-4 py-2.5">
      <p className="flex items-center gap-2 text-[13px] text-secondary">
        <Bot className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <span>
          Tự động hoá:{' '}
        {run ? (
          <span className="font-semibold text-ink">Đang chạy{run.planned ? ` · ${run.completed}/${run.planned}` : ''}</span>
        ) : runs.length > 0 ? (
          <span className="text-secondary">Đã có {runs.length} lượt chạy · hiện không chạy</span>
        ) : (
          <span className="text-secondary">Auto Pilot đang tắt</span>
        )}
        </span>
      </p>
      <Link to="/autopilot" className="link-accent text-[13px]">Mở Auto Pilot</Link>
    </div>
  )
}
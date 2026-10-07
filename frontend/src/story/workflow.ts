/**
 * STORY PRODUCTION WORKFLOW — state resolver (PASS 1)
 *
 * Pure functions. No React, no network. Takes already-fetched API data and
 * returns workflow node states + the single next action.
 *
 * Every value below comes from real backend state. Nothing is invented.
 * Where the backend cannot answer, the step is UNAVAILABLE — never faked.
 *
 * Verified backend enums (read from source, not guessed):
 *   plan.status        REVIEW | APPROVED | REJECTED        api/v1/director.py:152,214,224
 *   scene.status       DRAFT | PLANNED | REVIEW_REQUIRED | APPROVED
 *                                                             api/v1/story.py:28
 *   character.lock_state REVIEW_REQUIRED | UNSUPPORTED | LOCKED
 *                                                             api/v1/story.py:30
 *   qc.verdict         PASS | REVIEW_REQUIRED | BLOCKED     media/qc.py:51
 *   gate.decision      PASS | BLOCKED   (only two values)   media/qc.py:76
 *   job.node.status    PENDING | READY | WAITING_DEPS | RETRY_QUEUED |
 *                      RUNNING | SUCCEEDED | SKIPPED_REUSE | FAILED
 *                                                             engine/runner.py
 *   job.node.type      IMAGE | TTS | VIDEO | SUBTITLE | COMPOSE |
 *                      PROJECT_COMPOSE | QC                  engine/runner.py:200-329
 */

export type StepId =
  | 'IDEA' | 'DIRECTOR' | 'SCENES' | 'MEDIA' | 'TTS'
  | 'SUBTITLE' | 'RENDER' | 'QC' | 'GATE' | 'SCHEDULE' | 'PUBLISH'

export type StepState =
  | 'COMPLETED' | 'RUNNING' | 'WAITING' | 'REVIEW' | 'BLOCKED' | 'FAILED' | 'UNAVAILABLE'

export const STEP_ORDER: StepId[] = [
  'IDEA', 'DIRECTOR', 'SCENES', 'MEDIA', 'TTS',
  'SUBTITLE', 'RENDER', 'QC', 'GATE', 'SCHEDULE', 'PUBLISH',
]

export const STEP_LABEL: Record<StepId, string> = {
  IDEA: 'Ý tưởng',
  DIRECTOR: 'AI Director',
  SCENES: 'Cảnh',
  MEDIA: 'Media',
  TTS: 'TTS',
  SUBTITLE: 'Phụ đề',
  RENDER: 'Dựng',
  QC: 'QC',
  GATE: 'Cổng SX',
  SCHEDULE: 'Lịch đăng',
  PUBLISH: 'Đăng bài',
}

/** Minimal shapes the resolver needs. Structurally compatible with api/client.ts. */
export interface PlanLite {
  id: string
  version: number
  status: string
  origin?: string
  mock?: boolean
  plan?: {
    scenes?: { scene_number: number }[]
    duration?: number
    [k: string]: unknown
  }
}
export interface CharacterLite { id: string; name: string; lock_state: string }
export interface SceneLite {
  id: string
  order?: number
  status: string
  duration_s?: number | null
}
export interface ArtifactLite {
  id: string
  kind: string
  scene_id?: string | null
  bytes?: number
  duration_s?: number | null
  width?: number | null
  height?: number | null
  mime?: string
  created_at?: string
}
export interface ScheduleLite { id: string; status: string; run_at: string }
export interface JobNodeLite { type: string; status: string }
export interface QcCheckLite { key: string; status: string; detail?: string }
export interface QcResultLite {
  qc: { verdict: string; checks: QcCheckLite[] }
  gate: { decision: string; reasons: string[] }
}

export interface WorkflowInput {
  project: { description: string; status: string; duration_target: number; language: string; updated_at?: string }
  plans: PlanLite[]
  characters: CharacterLite[]
  scenes: SceneLite[]
  /** Project-level artifacts. GET /projects/{id}/artifacts works with no scene filter. */
  artifacts: ArtifactLite[]
  schedules: ScheduleLite[]
  /** Nodes of jobs currently in flight (QUEUED/RUNNING). Flattened by the caller. */
  activeNodes: JobNodeLite[]
  /** Session-only. There is no GET /qc and QC jobs are not persisted. BACKEND GAP. */
  qc?: QcResultLite | null
  autopilot?: { status: string; completed: number; planned: number } | null
}

export interface WorkflowNode {
  id: StepId
  label: string
  state: StepState
  /** e.g. "6" or "3/6". Only when it helps the user. */
  count?: string
  detail?: string
}

export type ActionKind = 'DECISION' | 'ACTIVITY' | 'WAITING' | 'NONE'
export type Intent =
  | 'CREATE_PLAN' | 'APPROVE_PLAN' | 'REJECT_PLAN' | 'REGENERATE_PLAN' | 'VIEW_PLAN'
  | 'CREATE_SCENE' | 'ENABLE_AUTOPILOT'
  | 'GEN_IMAGE' | 'GEN_TTS' | 'GEN_SUBTITLE' | 'RENDER_SCENE' | 'RENDER_PROJECT'
  | 'RUN_QC' | 'VIEW_GATE' | 'EXPORT' | 'CREATE_SCHEDULE' | 'PUBLISH'

export interface Cta { label: string; intent: Intent }
export interface NextAction {
  kind: ActionKind
  step: StepId
  title: string
  detail?: string
  ctas: Cta[]
}

/**
 * THE single node-type -> workflow-step mapping. Nothing else may map these.
 *
 * BACKEND GAP: this is read off the engine implementation (engine/runner.py
 * builds nodes with exactly these types and each writes a known artifact
 * kind). It is NOT an independently exposed API enum contract.
 *
 * `VIDEO -> MEDIA` is an inference: runner.py maps it to VIDEO_GENERATION,
 * which produces a scene asset, so it belongs to Media rather than Render.
 * Render is compose-only (COMPOSE / PROJECT_COMPOSE). Nobody has published a
 * contract stating this, so it stays documented rather than "confirmed".
 *
 * Unknown type -> null. Never guess.
 */
export function nodeTypeToStep(type: string): StepId | null {
  switch (type) {
    case 'IMAGE':
    case 'VIDEO':
      return 'MEDIA'
    case 'TTS':
      return 'TTS'
    case 'SUBTITLE':
      return 'SUBTITLE'
    case 'COMPOSE':
    case 'PROJECT_COMPOSE':
      return 'RENDER'
    case 'QC':
      return 'QC'
    default:
      return null
  }
}

/** Steps a job is currently touching. RUNNING wins over QUEUED. */
export function activeSteps(nodes: JobNodeLite[]): Set<StepId> {
  const live = new Set<StepId>()
  nodes.forEach((n) => {
    const step = nodeTypeToStep(n.type)
    if (step && (n.status === 'RUNNING' || n.status === 'RETRY_QUEUED' || n.status === 'PENDING' || n.status === 'WAITING_DEPS' || n.status === 'READY')) {
      live.add(step)
    }
  })
  return live
}

export function latestPlan(plans: PlanLite[]): PlanLite | null {
  if (plans.length === 0) return null
  return plans.reduce((a, b) => (b.version > a.version ? b : a))
}

function artifactsOfKind(list: ArtifactLite[], kind: string, sceneId?: string): ArtifactLite[] {
  return list.filter((a) => a.kind === kind && (sceneId === undefined || (a.scene_id ?? null) === sceneId))
}

/** Project-level output: a VIDEO artifact with no scene, written under renders/. */
export function projectOutput(list: ArtifactLite[]): ArtifactLite | null {
  return list.find((a) => a.kind === 'VIDEO' && (a.scene_id ?? null) === null) ?? null
}

export function resolveWorkflow(input: WorkflowInput): WorkflowNode[] {
  const { project, plans, scenes, artifacts, schedules, activeNodes } = input
  const plan = latestPlan(plans)
  const live = activeSteps(activeNodes)
  const nScenes = scenes.length
  const withKind = (k: string) => scenes.filter((s) => artifactsOfKind(artifacts, k, s.id).length > 0)
  const out = projectOutput(artifacts)
  const sceneVideos = scenes.filter((s) => artifactsOfKind(artifacts, 'VIDEO', s.id).length > 0)
  const qc = input.qc ?? null

  const partial = (done: number): string => `${done}/${nScenes}`
  const mediaDone = withKind('IMAGE').length
  const ttsDone = withKind('TTS').length
  const subDone = withKind('SUBTITLE').length

  const nodes: WorkflowNode[] = [
    {
      id: 'IDEA',
      label: STEP_LABEL.IDEA,
      state: project.description.trim() ? 'COMPLETED' : 'WAITING',
      detail: project.description.trim() ? undefined : 'Chưa có ý tưởng',
    },
    {
      id: 'DIRECTOR',
      label: STEP_LABEL.DIRECTOR,
      state: !plan
        ? 'WAITING'
        : plan.status === 'REVIEW'
          ? 'REVIEW'
          : plan.status === 'APPROVED'
            ? 'COMPLETED'
            : plan.status === 'REJECTED'
              ? 'FAILED'
              : 'WAITING',
      count: plan ? `v${plan.version}` : undefined,
      detail: !plan
        ? 'Chưa có kế hoạch'
        : plan.status === 'REVIEW'
          ? 'Chờ duyệt'
          : plan.status === 'REJECTED'
            ? 'Đã từ chối'
            : undefined,
    },
    {
      id: 'SCENES',
      label: STEP_LABEL.SCENES,
      state: nScenes > 0
        ? 'COMPLETED'
        : plan?.status === 'REVIEW'
          ? 'BLOCKED'
          : 'WAITING',
      count: nScenes > 0 ? String(nScenes) : undefined,
      detail: nScenes === 0 && plan?.status === 'APPROVED'
        ? 'Kế hoạch đã duyệt nhưng chưa có cảnh — duyệt kế hoạch không tự sinh cảnh'
        : nScenes === 0 && plan?.status === 'REVIEW'
          ? 'Chờ duyệt kế hoạch'
          : undefined,
    },
    {
      id: 'MEDIA',
      label: STEP_LABEL.MEDIA,
      state: nScenes === 0
        ? 'WAITING'
        : mediaDone === nScenes
          ? 'COMPLETED'
          : live.has('MEDIA')
            ? 'RUNNING'
            : 'WAITING',
      count: nScenes > 0 && mediaDone < nScenes ? partial(mediaDone) : nScenes > 0 ? String(nScenes) : undefined,
      detail: nScenes === 0 ? 'Chờ có cảnh' : undefined,
    },
    {
      id: 'TTS',
      label: STEP_LABEL.TTS,
      state: nScenes === 0
        ? 'WAITING'
        : ttsDone === nScenes
          ? 'COMPLETED'
          : live.has('TTS')
            ? 'RUNNING'
            : 'WAITING',
      count: nScenes > 0 && ttsDone < nScenes ? partial(ttsDone) : nScenes > 0 ? String(nScenes) : undefined,
      detail: nScenes === 0 ? 'Chờ có cảnh' : undefined,
    },
    {
      id: 'SUBTITLE',
      label: STEP_LABEL.SUBTITLE,
      state: nScenes === 0
        ? 'WAITING'
        : subDone === nScenes
          ? 'COMPLETED'
          : live.has('SUBTITLE')
            ? 'RUNNING'
            : 'WAITING',
      count: nScenes > 0 && subDone < nScenes ? partial(subDone) : nScenes > 0 ? String(nScenes) : undefined,
      detail: nScenes === 0 ? 'Chờ có cảnh' : undefined,
    },
    {
      id: 'RENDER',
      label: STEP_LABEL.RENDER,
      state: out
        ? 'COMPLETED'
        : live.has('RENDER')
          ? 'RUNNING'
          : nScenes === 0
            ? 'WAITING'
            : sceneVideos.length > 0
              ? 'WAITING'
              : 'WAITING',
      count: out ? undefined : nScenes > 0 ? partial(sceneVideos.length) : undefined,
      detail: out
        ? `${out.width ?? '?'}×${out.height ?? '?'}`
        : nScenes === 0
          ? 'Chờ có cảnh'
          : sceneVideos.length === nScenes
            ? 'Đã dựng từng cảnh — còn ghép dự án'
            : undefined,
    },
    {
      id: 'QC',
      label: STEP_LABEL.QC,
      state: !qc ? 'WAITING' : qc.qc.verdict === 'PASS' ? 'COMPLETED' : qc.qc.verdict === 'REVIEW_REQUIRED' ? 'REVIEW' : 'BLOCKED',
      count: qc ? String(qc.qc.checks.filter((c) => c.status === 'FAIL').length || '') || undefined : undefined,
      detail: !qc ? 'Chưa có kết quả kiểm định' : qc.qc.verdict === 'PASS' ? undefined : 'Có mục chưa đạt',
    },
    {
      id: 'GATE',
      label: STEP_LABEL.GATE,
      state: !qc ? 'WAITING' : qc.gate.decision === 'PASS' ? 'COMPLETED' : 'BLOCKED',
      detail: !qc
        ? 'Chưa có kết quả kiểm định'
        : qc.gate.decision === 'BLOCKED'
          ? `${qc.gate.reasons.length} mục chưa đạt`
          : undefined,
    },
    {
      id: 'SCHEDULE',
      label: STEP_LABEL.SCHEDULE,
      state: schedules.length === 0
        ? 'WAITING'
        : schedules.some((s) => s.status === 'MISSED')
          ? 'REVIEW'
          : 'COMPLETED',
      count: schedules.length > 0 ? String(schedules.length) : undefined,
      detail: schedules.length === 0 ? 'Chưa lên lịch' : schedules.some((s) => s.status === 'MISSED') ? 'Có lịch bị bỏ lỡ' : undefined,
    },
    {
      id: 'PUBLISH',
      label: STEP_LABEL.PUBLISH,
      // No per-project publish listing exists, so the outcome can never be read.
      state: schedules.some((s) => s.status === 'DISPATCHED') ? 'UNAVAILABLE' : 'WAITING',
      detail: schedules.some((s) => s.status === 'DISPATCHED')
        ? 'Đã phát lịch đăng — backend chưa có API đọc kết quả'
        : undefined,
    },
  ]

  return STEP_ORDER.map((id) => nodes.find((n) => n.id === id)!).filter(Boolean)
}

/**
 * Next action. First matching rule wins. Returns ACTIVITY whenever a job is in
 * flight so we never offer a write that would collide with running work.
 */
export function resolveNextAction(input: WorkflowInput): NextAction {
  const { project, plans, scenes, artifacts, schedules, activeNodes, qc } = input
  const plan = latestPlan(plans)
  const live = activeSteps(activeNodes)
  const nScenes = scenes.length
  const withKind = (k: string) => scenes.filter((s) => artifactsOfKind(artifacts, k, s.id).length > 0)
  const missing = (k: string) => scenes.filter((s) => artifactsOfKind(artifacts, k, s.id).length === 0)
  const out = projectOutput(artifacts)

  // Running work takes priority — never hand out a competing write action.
  if (live.size > 0) {
    const step = [...live][0]
    const label = STEP_LABEL[step]
    const total = activeNodes.filter((n) => nodeTypeToStep(n.type) === step).length
    return {
      kind: 'ACTIVITY',
      step,
      title: `${label} đang xử lý`,
      detail: total > 1 ? `${total} bước con đang chạy` : undefined,
      ctas: [],
    }
  }

  // Plan rules only gate work that has not started yet.
  //
  // WHY: scenes can be created without a plan — POST /projects/{id}/scenes is a
  // plain body insert, and Auto Pilot writes Scene rows directly
  // (autopilot/service.py:151). So "no plan" does NOT imply "no scenes".
  // Once scenes exist, the Director gate is behind us and must not block
  // production. Assuming Director-approved implies scenes exist is exactly the
  // wrong inference: approving a plan does not materialise scenes.
  const planGatesWork = nScenes === 0

  // 1. Project input not sufficient
  if (!project.description.trim() && !plan) {
    return {
      kind: 'DECISION',
      step: 'IDEA',
      title: 'Chưa có ý tưởng câu chuyện',
      detail: 'Nhập ý tưởng để AI Director lập kế hoạch.',
      ctas: [{ label: 'Nhập ý tưởng', intent: 'VIEW_PLAN' }],
    }
  }

  // 2. No plan yet
  if (!plan && planGatesWork) {
    return {
      kind: 'DECISION',
      step: 'DIRECTOR',
      title: 'AI Director chưa có kế hoạch',
      detail: 'AI sẽ sinh kịch bản, chia cảnh và lời thoại từ ý tưởng của bạn.',
      ctas: [{ label: 'Tạo kịch bản', intent: 'CREATE_PLAN' }],
    }
  }

  // 3. Plan awaiting review
  if (plan?.status === 'REVIEW' && planGatesWork) {
    const n = plan.plan?.scenes?.length ?? 0
    return {
      kind: 'DECISION',
      step: 'DIRECTOR',
      title: `Kế hoạch v${plan.version} đang chờ duyệt`,
      detail: n > 0 ? `${n} cảnh · ${plan.plan?.duration ?? '?'} giây` : undefined,
      ctas: [
        { label: 'Xem kế hoạch', intent: 'VIEW_PLAN' },
        { label: 'Duyệt', intent: 'APPROVE_PLAN' },
        { label: 'Từ chối', intent: 'REJECT_PLAN' },
      ],
    }
  }

  // 4. Plan rejected
  if (plan?.status === 'REJECTED' && planGatesWork) {
    return {
      kind: 'DECISION',
      step: 'DIRECTOR',
      title: `Kế hoạch v${plan.version} đã bị từ chối`,
      detail: 'Tạo lại kế hoạch để tiếp tục.',
      ctas: [{ label: 'Tạo lại kế hoạch', intent: 'REGENERATE_PLAN' }],
    }
  }

  // 5. Plan approved but no scenes — approving does not materialise scenes.
  if (nScenes === 0) {
    return {
      kind: 'DECISION',
      step: 'SCENES',
      title: 'Kế hoạch đã duyệt, chưa có cảnh',
      detail: 'Duyệt kế hoạch không tự sinh cảnh. Tạo cảnh thủ công, hoặc bật Auto Pilot để tạo tự động.',
      ctas: [
        { label: 'Tạo cảnh thủ công', intent: 'CREATE_SCENE' },
        { label: 'Bật Auto Pilot', intent: 'ENABLE_AUTOPILOT' },
      ],
    }
  }

  const imgMissing = missing('IMAGE')
  if (imgMissing.length > 0) {
    return {
      kind: 'DECISION',
      step: 'MEDIA',
      title: `${imgMissing.length}/${nScenes} cảnh chưa có hình minh hoạ`,
      detail: 'Cần hình cho từng cảnh trước khi tạo giọng đọc.',
      ctas: [{ label: 'Tạo hình minh hoạ', intent: 'GEN_IMAGE' }],
    }
  }

  const ttsMissing = missing('TTS')
  if (ttsMissing.length > 0) {
    return {
      kind: 'DECISION',
      step: 'TTS',
      title: `${ttsMissing.length}/${nScenes} cảnh chưa có giọng đọc`,
      detail: 'Dựng cảnh yêu cầu có cả hình và giọng đọc.',
      ctas: [{ label: 'Tạo giọng đọc', intent: 'GEN_TTS' }],
    }
  }

  const subMissing = missing('SUBTITLE')
  if (subMissing.length > 0) {
    return {
      kind: 'DECISION',
      step: 'SUBTITLE',
      title: `${subMissing.length}/${nScenes} cảnh chưa có phụ đề`,
      ctas: [{ label: 'Tạo phụ đề', intent: 'GEN_SUBTITLE' }],
    }
  }

  // Project output existing means rendering is finished — do not ask for scene renders.
  const sceneVideos = scenes.filter((s) => artifactsOfKind(artifacts, 'VIDEO', s.id).length > 0)
  if (!out && sceneVideos.length < nScenes) {
    return {
      kind: 'DECISION',
      step: 'RENDER',
      title: `${nScenes - sceneVideos.length}/${nScenes} cảnh chưa dựng`,
      detail: 'Tất cả cảnh đã đủ hình, giọng đọc và phụ đề.',
      ctas: [{ label: 'Dựng video', intent: 'RENDER_SCENE' }],
    }
  }

  if (!out) {
    return {
      kind: 'DECISION',
      step: 'RENDER',
      title: 'Đã dựng từng cảnh, chưa ghép dự án',
      ctas: [{ label: 'Dựng toàn bộ dự án', intent: 'RENDER_PROJECT' }],
    }
  }

  // QC is POST-only and never persisted server-side, so it cannot be auto-read.
  // Never auto-run it: that would be a write on page load.
  if (!qc) {
    return {
      kind: 'DECISION',
      step: 'QC',
      title: 'Chưa có kết quả kiểm định',
      detail: 'Bấm chạy để nhà máy kiểm tra video, âm thanh, phụ đề và quyền sử dụng.',
      ctas: [{ label: 'Chạy kiểm định', intent: 'RUN_QC' }],
    }
  }

  if (qc.gate.decision === 'BLOCKED') {
    return {
      kind: 'DECISION',
      step: 'GATE',
      title: 'Chưa đủ điều kiện xuất bản',
      detail: `${qc.gate.reasons.length} mục chưa đạt.`,
      ctas: [{ label: 'Xem lý do', intent: 'VIEW_GATE' }],
    }
  }

  if (schedules.length === 0) {
    return {
      kind: 'DECISION',
      step: 'SCHEDULE',
      title: 'Đã đủ điều kiện xuất bản',
      detail: 'Chọn thời điểm đăng.',
      ctas: [{ label: 'Lên lịch đăng', intent: 'CREATE_SCHEDULE' }],
    }
  }

  return {
    kind: 'WAITING',
    step: 'PUBLISH',
    title: 'Đã lên lịch',
    detail: 'Backend chưa có API đọc kết quả đăng theo dự án.',
    ctas: [],
  }
}

export function gateAllowsExport(input: WorkflowInput): boolean {
  const qc = input.qc ?? null
  return !!qc && qc.gate.decision === 'PASS'
}
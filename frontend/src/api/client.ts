/* Typed API client for /api/v1. No secrets stored client-side. */
export interface HealthResponse {
  status: string
  service: string
  request_id: string
}

export interface DiagnosticsResponse {
  request_id: string
  checks: Record<string, { status: string; detail?: string }>
}

export interface TypedError {
  error: { code: string; message: string; request_id: string }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  const requestId = res.headers.get('X-Request-Id') ?? ''
  if (!res.ok) {
    let body: TypedError | null = null
    try {
      body = (await res.json()) as TypedError
    } catch {
      body = null
    }
    const err = new Error(body?.error.message ?? `Request failed: ${res.status}`) as Error & {
      code?: string
      requestId?: string
    }
    err.code = body?.error.code ?? 'UNKNOWN_ERROR'
    err.requestId = body?.error.request_id ?? requestId
    throw err
  }
  return (await res.json()) as T
}

export const api = {
  health: () => request<HealthResponse>('/api/v1/health'),
  diagnostics: () => request<DiagnosticsResponse>('/api/v1/diagnostics'),
  // --- AI infrastructure (Phase 2, real APIs, no mock data) ---
  providers: () => request<{ request_id: string; data: Provider[] }>('/api/v1/ai/providers'),
  createProvider: (body: { name: string; base_url?: string; adapter_key?: string; enabled?: boolean }) =>
    request<{ request_id: string; data: Provider }>('/api/v1/ai/providers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  models: () => request<{ request_id: string; data: AiModel[] }>('/api/v1/ai/models'),
  createModel: (body: Record<string, unknown>) =>
    request<{ request_id: string; data: AiModel }>('/api/v1/ai/models', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  patchModel: (id: string, body: Record<string, unknown>) =>
    request<{ request_id: string; data: AiModel }>(`/api/v1/ai/models/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  deleteModel: (id: string) =>
    request<{ request_id: string; data: unknown }>(`/api/v1/ai/models/${id}`, { method: 'DELETE' }),
  testModel: (id: string, capability: string) =>
    request<{ request_id: string; data: { state: string; checks?: unknown; error?: string; note?: string; mock?: boolean } }>(
      `/api/v1/ai/models/${id}/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability }),
      }),
  saveCredential: (provider_id: string, secret: string) =>
    request<{ request_id: string; data: { configured: boolean; ref: string } }>(
      '/api/v1/ai/credentials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider_id, secret }),
      }),
  routerEligible: (capability = 'TEXT') =>
    request<{ request_id: string; data: { strategy_resolved: string; eligible: AiModel[]; excluded: { model: string; reason: string }[]; circuit: Record<string, string> } }>(
      `/api/v1/ai/router/eligible?capability=${capability}`),
  routerGenerate: (body: Record<string, unknown>) =>
    request<{ request_id: string; data: { output: string; strategy_resolved: string } | null; trace: TraceStep[]; error?: { code: string; message: string } }>(
      '/api/v1/ai/router/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
  activity: () =>
    request<{ request_id: string; data: ActivityEvent[] }>('/api/v1/ai/activity?limit=50'),
  usage: () => request<{ request_id: string; data: UsageSummary }>('/api/v1/ai/usage'),
  // --- Story Factory (Phase 3, real APIs) ---
  projects: () => request<{ request_id: string; data: Project[] }>('/api/v1/projects'),
  createProject: (body: Record<string, unknown>) =>
    request<{ request_id: string; data: Project }>('/api/v1/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  updateProject: (id: string, body: Record<string, unknown>) =>
    request<{ request_id: string; data: Project }>(`/api/v1/projects/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  project: (id: string) => request<{ request_id: string; data: Project }>(`/api/v1/projects/${id}`),
  deleteProject: (id: string) =>
    request<{ request_id: string; data: { deleted: string } }>(`/api/v1/projects/${id}`, { method: 'DELETE' }),
  characters: (projectId: string) =>
    request<{ request_id: string; data: Character[] }>(`/api/v1/projects/${projectId}/characters`),
  createCharacter: (projectId: string, body: Record<string, unknown>) =>
    request<{ request_id: string; data: Character }>(`/api/v1/projects/${projectId}/characters`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  updateCharacter: (characterId: string, body: Record<string, unknown>) =>
    request<{ request_id: string; data: Character }>(`/api/v1/characters/${characterId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  /** Reference image upload. Multipart per the API contract. */
  uploadCharacterReference: (characterId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request<{ request_id: string; data: { artifact_id: string; path: string } }>(
      `/api/v1/characters/${characterId}/references`,
      { method: 'POST', body: fd },
    )
  },
  scenes: (projectId: string) =>
    request<{ request_id: string; data: Scene[] }>(`/api/v1/projects/${projectId}/scenes`),
  createScene: (projectId: string, body: Record<string, unknown>) =>
    request<{ request_id: string; data: Scene }>(`/api/v1/projects/${projectId}/scenes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  plans: (projectId: string) =>
    request<{ request_id: string; data: DirectorPlan[] }>(`/api/v1/projects/${projectId}/director`),
  latestPlan: (projectId: string) =>
    request<{ request_id: string; data: DirectorPlan }>(`/api/v1/projects/${projectId}/director/latest`),
  generatePlan: (projectId: string, body: Record<string, unknown>) =>
    request<{ request_id: string; data: DirectorPlan }>(`/api/v1/projects/${projectId}/director`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  approvePlan: (id: string) =>
    request<{ request_id: string; data: DirectorPlan }>(`/api/v1/director/${id}/approve`, { method: 'POST' }),
  rejectPlan: (id: string) =>
    request<{ request_id: string; data: DirectorPlan }>(`/api/v1/director/${id}/reject`, { method: 'POST' }),
  regeneratePlan: (id: string, body: Record<string, unknown>) =>
    request<{ request_id: string; data: DirectorPlan }>(`/api/v1/director/${id}/regenerate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  regenerateSection: (id: string, section: string) =>
    request<{ request_id: string; data: DirectorPlan }>(`/api/v1/director/${id}/regenerate-section`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ section }),
    }),
  editPlan: (id: string, plan: Record<string, unknown>) =>
    request<{ request_id: string; data: DirectorPlan }>(`/api/v1/director/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }),
    }),
  // --- Media pipeline (Phase 4, real APIs) ---
  sceneArtifacts: (projectId: string, sceneId: string) =>
    request<{ request_id: string; data: Artifact[] }>(
      `/api/v1/projects/${projectId}/artifacts?scene_id=${sceneId}`),
  /** Project-level artifact list. scene_id and kind are both optional server-side. */
  sceneArtifactsAll: (projectId: string) =>
    request<{ request_id: string; data: Artifact[] }>(`/api/v1/projects/${projectId}/artifacts`),
  genSceneMedia: (projectId: string, sceneId: string, kind: 'image' | 'video' | 'tts') =>
    request<{ request_id: string; data: { job_id: string; artifacts: Artifact[] } }>(
      `/api/v1/projects/${projectId}/scenes/${sceneId}/${kind}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      }),
  genSubtitle: (projectId: string, sceneId: string) =>
    request<{ request_id: string; data: { job_id: string; artifacts: Artifact[] } }>(
      `/api/v1/projects/${projectId}/scenes/${sceneId}/subtitle`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      }),
  renderScene: (projectId: string, sceneId: string) =>
    request<{ request_id: string; data: { job_id: string; artifacts: Artifact[] } }>(
      `/api/v1/projects/${projectId}/scenes/${sceneId}/render`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      }),
  renderProject: (projectId: string) =>
    request<{ request_id: string; data: { job_id: string; artifacts: Artifact[] } }>(
      `/api/v1/projects/${projectId}/render`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      }),
  runQC: (projectId: string) =>
    request<{
      request_id: string
      data: {
        qc: { verdict: string; checks: { key: string; status: string; detail: string }[] }
        gate: { decision: string; reasons: string[] }
        job_id: string
      }
    }>(
      `/api/v1/projects/${projectId}/qc`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disclosure: true }),
      }),
  exportProject: (projectId: string) =>
    request<{ request_id: string; data: { export_id: string; manifest: { files: Record<string, string> } } }>(
      `/api/v1/projects/${projectId}/export`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disclosure_text: 'AI-generated content.' }),
      }),
  // --- Automation engine (Phase 5, real APIs) ---
  jobs: (status?: string) =>
    request<{ request_id: string; data: Job[] }>(
      status ? `/api/v1/jobs?status=${status}` : '/api/v1/jobs'),
  createJob: (projectId: string) =>
    request<{ request_id: string; data: Job & { replay: boolean } }>('/api/v1/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId, kind: 'FULL_PIPELINE',
        idempotency_key: `ui-${projectId}-${Date.now()}`,
      }),
    }),
  job: (id: string) => request<{ request_id: string; data: JobDetail }>(`/api/v1/jobs/${id}`),
  jobAction: (id: string, action: 'pause' | 'resume' | 'cancel' | 'retry') =>
    request<{ request_id: string; data: Job }>(`/api/v1/jobs/${id}/${action}`, { method: 'POST' }),
  // --- Auto Pilot + Scheduler (Phase 6, real APIs) ---
  apConfig: (projectId: string) =>
    request<{ request_id: string; data: ApConfig }>(`/api/v1/projects/${projectId}/autopilot/config`),
  saveApConfig: (projectId: string, body: Record<string, unknown>) =>
    request<{ request_id: string; data: ApConfig }>(`/api/v1/projects/${projectId}/autopilot/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  apRuns: (projectId: string) =>
    request<{ request_id: string; data: ApRun[] }>(`/api/v1/projects/${projectId}/autopilot/runs`),
  startApRun: (projectId: string) =>
    request<{ request_id: string; data: ApRun }>(`/api/v1/projects/${projectId}/autopilot/runs`, { method: 'POST' }),
  apRunAction: (runId: string, action: 'pause' | 'resume' | 'stop' | 'approve') =>
    request<{ request_id: string; data: ApRun }>(`/api/v1/autopilot/runs/${runId}/${action}`, { method: 'POST' }),
  schedules: (projectId: string) =>
    request<{ request_id: string; data: Schedule[] }>(`/api/v1/projects/${projectId}/scheduler/schedules`),
  createSchedule: (projectId: string, body: Record<string, unknown>) =>
    request<{ request_id: string; data: Schedule }>(`/api/v1/projects/${projectId}/scheduler/schedules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  cancelSchedule: (id: string) =>
    request<{ request_id: string; data: Schedule }>(`/api/v1/scheduler/schedules/${id}`, { method: 'DELETE' }),
  schedulerTick: () =>
    request<{ request_id: string; data: { processed: { id: string; status: string }[] } }>(
      '/api/v1/scheduler/tick', { method: 'POST' }),
  // --- Publisher (Phase 7, real APIs) ---
  platforms: () =>
    request<{ request_id: string; data: Platform[] }>('/api/v1/publisher/platforms'),
  oauthStart: (platform: string, clientId: string) =>
    request<{ request_id: string; data: { status: string; authorize_url?: string; message?: string } }>(
      `/api/v1/publisher/connections/${platform}/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      }),
  oauthDisconnect: (platform: string) =>
    request<{ request_id: string; data: Platform }>(
      `/api/v1/publisher/connections/${platform}/disconnect`, { method: 'POST' }),
  publishNow: (body: Record<string, unknown>) =>
    request<{ request_id: string; data: PublishJob }>(
      '/api/v1/publisher/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
  publishStatus: (id: string) =>
    request<{ request_id: string; data: PublishJob }>(`/api/v1/publisher/jobs/${id}`),
  publishRetry: (id: string) =>
    request<{ request_id: string; data: PublishJob }>(`/api/v1/publisher/jobs/${id}/retry`, { method: 'POST' }),
  // --- Affiliate Factory (Phase 8, isolated, real APIs) ---
  afProducts: () =>
    request<{ request_id: string; data: AfProduct[] }>('/api/v1/affiliate/products'),
  afCreateProduct: (body: Record<string, unknown>) =>
    request<{ request_id: string; data: AfProduct }>('/api/v1/affiliate/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  afDeleteProduct: (id: string) =>
    request<{ request_id: string; data: { deleted: string } }>(`/api/v1/affiliate/products/${id}`, {
      method: 'DELETE',
    }),
  afDeleteVideo: (videoId: string) =>
    request<{ request_id: string; data: { deleted: string } }>(`/api/v1/affiliate/videos/${videoId}`, {
      method: 'DELETE',
    }),
  afDeleteScript: (scriptId: string) =>
    request<{ request_id: string; data: { deleted: string } }>(`/api/v1/affiliate/scripts/${scriptId}`, {
      method: 'DELETE',
    }),
  afPatchProduct: (id: string, body: Record<string, unknown>) =>
    request<{ request_id: string; data: AfProduct }>(`/api/v1/affiliate/products/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  afAnalyze: (id: string) =>
    request<{ request_id: string; data: { analysis: Record<string, unknown> } }>(
      `/api/v1/affiliate/products/${id}/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      }),
  afScripts: (id: string) =>
    request<{ request_id: string; data: AfScript[] }>(`/api/v1/affiliate/products/${id}/scripts`),
  afCreateScript: (id: string, style: string) =>
    request<{ request_id: string; data: AfScript }>(`/api/v1/affiliate/products/${id}/scripts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ style }),
    }),
  afVideos: (id: string) =>
    request<{ request_id: string; data: AfVideo[] }>(`/api/v1/affiliate/products/${id}/videos`),
  afCreateVideo: (id: string, scriptId: string, visual: boolean) =>
    request<{ request_id: string; data: AfVideo }>(`/api/v1/affiliate/products/${id}/videos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script_id: scriptId, generate_visual: visual }),
    }),
  afRenderVideo: (videoId: string) =>
    request<{ request_id: string; data: AfVideo }>(`/api/v1/affiliate/videos/${videoId}/render`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }),
  afAutoVideo: (productId: string, scriptId: string) =>
    request<{ request_id: string; data: AfVideo }>(`/api/v1/affiliate/products/${productId}/auto-video`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script_id: scriptId }),
    }),
  afReviseScript: (videoId: string, message: string) =>
    request<{ request_id: string; data: AfScript }>(`/api/v1/affiliate/videos/${videoId}/revise`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    }),
  affiliateFileUrl: (videoId: string) =>
    `/api/v1/affiliate/videos/${videoId}/file/content`,
  afExportVideo: (videoId: string) =>
    request<{ request_id: string; data: { manifest: { file: string } } }>(
      `/api/v1/affiliate/videos/${videoId}/export`, { method: 'POST' }),
  // --- Analytics (Phase 9, real aggregations) ---
  analytics: () =>
    request<{ request_id: string; data: AnalyticsOverview }>('/api/v1/analytics/overview'),
  // --- Media bytes for in-app preview + download (video player / images) ---
  artifactMeta: (id: string) =>
    request<{ request_id: string; data: Artifact }>(`/api/v1/artifacts/${id}`),
  artifactUrl: (id: string) => `/api/v1/artifacts/${id}/content`,
  affiliateImageUrl: (productId: string) =>
    `/api/v1/affiliate/products/${productId}/image/content`,
  affiliateVisualUrl: (videoId: string) =>
    `/api/v1/affiliate/videos/${videoId}/visual/content`,
  afUploadImage: (productId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request<{ request_id: string; data: { path: string; sha256: string; mime: string; width: number; height: number } }>(
      `/api/v1/affiliate/products/${productId}/image`, { method: 'POST', body: fd })
  },
  afMoveScript: (scriptId: string, position: number) =>
    request<{ request_id: string; data: AfScript }>(`/api/v1/affiliate/scripts/${scriptId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position }),
    }),
}

export interface Artifact {
  id: string
  kind: string
  path: string
  sha256: string
  bytes: number
  mime: string
  provider: string
  model: string
  /** null for project-level output (final video); set for per-scene media. */
  scene_id?: string | null
  duration_s?: number | null
  width?: number | null
  height?: number | null
}

export interface JobNode {
  id: string
  type: string
  status: string
  attempts: number
  provider: string
  model: string
  error_code: string | null
  output?: { artifact_ids?: string[] } | null
}

export interface Job {
  id: string
  project_id: string
  kind: string
  status: string
  stage: string
  progress_percent: number | null
  status_text: string
}

export interface JobDetail extends Job {
  nodes: JobNode[]
  events: { event: string; node_id: string | null; status: string; error_category: string | null }[]
}

export interface ApConfig {
  enabled: boolean
  daily_target: number
  window_start: string
  window_end: string
  timezone: string
  topics: string[]
  require_approval_before_publish: boolean
  platforms: string[]
}

export interface ApRun {
  id: string
  status: string
  planned: number
  completed: number
  failed: number
  note: string
}

export interface Schedule {
  id: string
  job_id: string | null
  run_at: string
  timezone: string
  recurrence: string | null
  platforms: string[]
  status: string
  note: string
}

export interface Platform {
  platform: string
  status: string
  account: string | null
  support_state: string
}

export interface PublishJob {
  id: string
  project_id: string
  mode: string
  title: string
  platforms: string[]
  attempts: {
    platform: string
    status: string
    platform_post_id: string | null
    reason: string | null
  }[]
}

export interface AfProduct {
  id: string
  name: string
  description: string
  price: string
  videos: number
  image_path?: string | null
  image_sha256?: string | null
  audience?: string | null
  tone?: string | null
  style?: string | null
}

export interface AfScript {
  id: string
  style: string
  hook: string
  body: string
  cta: string
  disclosure: string
  disclosure_injected: boolean
  position: number
}

export interface AfVideo {
  id: string
  status: string
  visual_artifact_id: string | null
  script_id: string
  video_path?: string | null
  has_video?: boolean
  duration_s?: number | null
  progress?: number | null
}

export interface AnalyticsOverview {
  production: Record<string, number | Record<string, number>>
  ai: {
    requests: number
    successful: number
    failed: number
    fallbacks: number
    avg_latency_ms: number
    by_model: { model: string; count: number }[]
    by_error: { code: string; count: number }[]
    cost: number | null
    cost_state: string
  }
  automation: Record<string, number>
  publishing: {
    confirmed: number
    failed: number
    by_platform: { platform: string; count: number }[]
  }
  affiliate: Record<string, number>
}

export interface Provider {
  id: string
  name: string
  base_url: string
  adapter_key: string
  enabled: boolean
  health: string
  credential_configured: boolean
}

export interface AiModel {
  id: string
  provider_id: string
  name: string
  model_id: string
  capabilities: string[]
  priority: number
  enabled: boolean
  cost_class: string
  license_status: string
  health_status: string
}

export interface TraceStep {
  attempt: number
  provider: string
  model: string
  status: string
  error_code: string
  fallback_reason: string
  latency_ms: number
}

export interface ActivityEvent {
  request_id: string
  task: string
  capability: string
  provider: string
  model: string
  attempt: number
  latency_ms: number
  status: string
  error_category: string | null
  fallback_reason: string | null
  mock: boolean
}

export interface UsageSummary {
  requests: number
  successful: number
  failed: number
  fallbacks: number
  avg_latency_ms: number
  by_model: { model: string; count: number; successful?: number; avg_latency_ms?: number; last_used_at?: string | null }[]
  cost: number | null
  cost_state: string
}

export interface Project {
  id: string
  name: string
  description: string
  factory_type: string
  language: string
  style: string
  audience: string
  duration_target: number
  status: string
  created_at?: string
  updated_at?: string
}

export interface Character {
  id: string
  project_id: string
  kind: string
  name: string
  description: string
  visual_identity: string
  face: string
  hair: string
  clothes: string
  colors: string
  defining_features: string
  lock_state: string
  reference_asset_id?: string | null
}

export interface Scene {
  id: string
  order: number
  description: string
  dialogue: string
  status: string
  visual_prompt?: string
  camera?: string
  motion?: string
  environment?: string
  duration_s?: number | null
  characters_json?: unknown[]
}

export interface DirectorPlan {
  id: string
  project_id: string
  version: number
  status: string
  origin: string
  plan: {
    title: string
    hook?: string
    concept?: string
    story_structure?: string
    characters?: { name: string; role?: string; description?: string }[]
    scenes?: { scene_number: number; description?: string; dialogue?: string; camera?: string; duration?: number }[]
    visual_style?: string
    voice_style?: string
    duration?: number
    ending?: string
    cta?: string
    [k: string]: unknown
  }
  provider: string
  model: string
  request_id: string
  mock: boolean
}

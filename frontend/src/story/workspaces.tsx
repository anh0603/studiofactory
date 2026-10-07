import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Artifact, Character, DirectorPlan, Project, Scene, Schedule } from '../api/client'
import { EmptyState, ErrorState } from '../components/states'
import { Btn, Card, Field, ProgressNote, SpinnerSm, StatusBadge } from '../components/ui'
import { artifactKindVi, enumVi, hasEnum, lockStateVi, planOriginVi, qcCheckVi, sceneStatusVi } from '../i18n/enums.vi'
import { ExplainError } from '../components/explain-error'
import { api } from '../api/client'
import type { QcResultLite, StepId } from '../story/workflow'

/* One workspace per workflow node. Each one shows the work of that node only. */

export interface WorkspaceProps {
  activeStep: StepId
  project: Project
  saveProject: (body: Record<string, unknown>) => void
  saveProjectPending: boolean
  saveProjectError: string | null
  retrySaveProject: () => void
  projectId: string
  scenes: Scene[]
  artifacts: Artifact[]
  plans: DirectorPlan[]
  characters: Character[]
  schedules: Schedule[]
  qc: QcResultLite | null
  busyStep: StepId | null
  onStepBusy: (s: StepId | null) => void
  onRefresh: () => void
  onStep: (s: StepId) => void
  act: (planId: string, a: string, arg?: string) => void
  planActing: boolean
  createPlan: (body: { idea: string; audience: string; tone: string }) => void
  planPending: boolean
  planError: string | null
  onRetryPlan: () => void
  runQc: () => void
  qcPending: boolean
  qcError: string | null
  addCharacter: (name: string) => void
  characterPending: boolean
  genMedia: (sceneId: string, kind: 'image' | 'tts' | 'video') => Promise<void>
  genSubtitle: (sceneId: string) => Promise<void>
  renderScene: (sceneId: string) => Promise<void>
  renderProject: () => Promise<void>
  exportProject: () => Promise<string>
  createScene: (body: { order: number; description: string; dialogue: string; visual_prompt: string; camera: string; status: string }) => void
  scenePending: boolean
  createSchedule: (body: { date: string; time: string; platforms: string[] }) => void
  schedulePending: boolean
  cancelSchedule: (id: string) => void
}

function bytes(n?: number): string {
  if (!n && n !== 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function ArtifactList({
  title, hint, artifacts, scenes, emptyTitle, emptyHint, actions,
}: {
  title: string
  hint?: string
  artifacts: Artifact[]
  scenes: Scene[]
  emptyTitle: string
  emptyHint?: string
  actions?: (scene: Scene) => React.ReactNode
}) {
  const sceneName = (id?: string | null) => {
    const s = scenes.find((x) => x.id === id)
    return s ? `Cảnh #${s.order}` : 'Toàn dự án'
  }
  return (
    <Card>
      <h2 className="section-title">{title}</h2>
      {hint ? <p className="mt-0.5 text-[13px] text-secondary">{hint}</p> : null}
      {artifacts.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-border bg-panel px-4 py-6 text-center">
          <p className="text-[13px] font-medium text-secondary">{emptyTitle}</p>
          {emptyHint ? <p className="mt-1 text-[12px] text-muted">{emptyHint}</p> : null}
        </div>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {artifacts.map((a) => (
            <li key={a.id} className="rounded-lg border border-border bg-bg px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium">{sceneName(a.scene_id)}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="mono text-[11px] text-muted">
                    {enumVi(a.kind, artifactKindVi)} · {bytes(a.bytes)}
                    {a.duration_s ? ` · ${a.duration_s.toFixed(1)}s` : ''}
                    {a.width && a.height ? ` · ${a.width}×${a.height}` : ''}
                  </span>
                  <a
                    href={api.artifactUrl(a.id)}
                    download={a.path.split('/').pop() || a.id}
                    className="link-accent text-[12px]"
                  >
                    Tải xuống
                  </a>
                </div>
              </div>
              {actions && a.scene_id ? actions(scenes.find((s) => s.id === a.scene_id)!) : null}
            </li>
          ))}
        </ul>
      )}
      {actions && artifacts.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {scenes.map((s) => <span key={s.id}>{actions(s)}</span>)}
        </div>
      ) : null}
    </Card>
  )
}

/* ---------------------------------------------------------------- IDEA */

function IdeaWs({ p, onStep, saveProject, saveProjectPending, saveProjectError, retrySaveProject }: Pick<
  WorkspaceProps, 'onStep' | 'saveProject' | 'saveProjectPending' | 'saveProjectError' | 'retrySaveProject'
> & { p: Project }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(p.name)
  const [desc, setDesc] = useState(p.description)
  const [audience, setAudience] = useState(p.audience)
  const [duration, setDuration] = useState(String(p.duration_target))
  const [language, setLanguage] = useState(p.language)
  const [style, setStyle] = useState(p.style)

  const hasIdea = p.description.trim().length > 0

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="section-title">Ý tưởng</h2>
            <p className="mt-1 text-[13px] text-secondary">
              AI Director cần tên và mô tả để viết kịch bản.
            </p>
          </div>
          <Btn size="sm" onClick={() => setEditing(!editing)}>{editing ? 'Đóng' : 'Sửa'}</Btn>
        </div>

        {editing ? (
          <div className="mt-3 space-y-2">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-secondary" htmlFor="idea-name">Tên câu chuyện</label>
              <Field id="idea-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-secondary" htmlFor="idea-desc">Mô tả / ý tưởng</label>
              <Field id="idea-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Một chú mèo dũng cảm đi tìm mẹ trong rừng sương" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[12px] font-medium text-secondary" htmlFor="idea-aud">Khán giả</label>
                <Field id="idea-aud" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="trẻ em 6-9 tuổi" />
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-secondary" htmlFor="idea-dur">Thời lượng (giây)</label>
                <Field id="idea-dur" type="number" value={duration} onChange={(e) => setDuration(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-secondary" htmlFor="idea-lang">Ngôn ngữ</label>
                <Field id="idea-lang" value={language} onChange={(e) => setLanguage(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-secondary" htmlFor="idea-style">Phong cách</label>
                <Field id="idea-style" value={style} onChange={(e) => setStyle(e.target.value)} placeholder="tuỳ chọn" />
              </div>
            </div>
            <Btn
              variant="accent"
              busy={saveProjectPending}
              disabled={!name.trim() || saveProjectPending}
              onClick={() => {
                saveProject({
                  name: name.trim(),
                  description: desc.trim(),
                  audience: audience.trim(),
                  duration_target: Number(duration) || 30,
                  language: language.trim() || 'vi',
                  style: style.trim(),
                })
                setEditing(false)
              }}
            >
              Lưu ý tưởng
            </Btn>
            {saveProjectError ? (
              <div className="mt-2">
                <ExplainError
                  what="Không lưu được ý tưởng."
                  error={saveProjectError}
                  todo="Điền tên câu chuyện rồi thử lại."
                  onRetry={retrySaveProject}
                />
              </div>
            ) : null}
          </div>
        ) : (
          <dl className="mt-3 space-y-2 text-[13px]">
            <div><dt className="text-muted">Tên dự án</dt><dd className="mt-0.5 text-ink">{p.name}</dd></div>
            <div>
              <dt className="text-muted">Mô tả</dt>
              <dd className="mt-0.5 text-secondary">{p.description || 'Chưa có mô tả'}</dd>
            </div>
            <div><dt className="text-muted">Khán giả</dt><dd className="mt-0.5 text-secondary">{p.audience || '—'}</dd></div>
            <div><dt className="text-muted">Thời lượng</dt><dd className="mt-0.5 text-secondary">{p.duration_target}s</dd></div>
            <div><dt className="text-muted">Ngôn ngữ</dt><dd className="mt-0.5 text-secondary">{p.language}</dd></div>
            <div><dt className="text-muted">Phong cách</dt><dd className="mt-0.5 text-secondary">{p.style || '—'}</dd></div>
          </dl>
        )}
      </Card>

      <Card>
        <h2 className="section-title mb-1">Bước tiếp theo</h2>
        {hasIdea ? (
          <>
            <p className="text-[13px] text-secondary">
              AI sẽ viết kịch bản và chia cảnh từ ý tưởng này.
            </p>
            <Btn variant="accent" className="mt-3" onClick={() => onStep('DIRECTOR')}>Tạo kịch bản bằng AI</Btn>
          </>
        ) : (
          <>
            <p className="text-[13px] text-warn">Vui lòng nhập ý tưởng trước.</p>
            <p className="mt-1 text-[13px] text-secondary">
              Mô tả càng rõ (nhân vật, bối cảnh, điều muốn xảy ra), kịch bản càng sát ý bạn.
            </p>
            <Btn className="mt-3" onClick={() => setEditing(true)}>Nhập ý tưởng</Btn>
          </>
        )}
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------ DIRECTOR */

function DirectorWs({
  plans, planActing, createPlan, planPending, planError, onRetryPlan, act, onRefresh, project,
}: Pick<WorkspaceProps, 'plans' | 'planActing' | 'createPlan' | 'planPending' | 'planError' | 'onRetryPlan' | 'act' | 'onRefresh' | 'project'>) {
  // Pre-fill from the real project description so the user does not retype.
  const [idea, setIdea] = useState(project.description)
  const [audience, setAudience] = useState(project.audience || 'trẻ em 6-9 tuổi')
  const [tone, setTone] = useState('vui vẻ')
  const [viewId, setViewId] = useState<string | null>(null)

  const sorted = [...plans].sort((a, b) => b.version - a.version)
  const latest = sorted[0] ?? null
  const viewing = sorted.find((p) => p.id === viewId) ?? latest
  const isStale = !!viewing && !!latest && viewing.id !== latest.id
  const canDecide = !!latest && latest.status === 'REVIEW' && viewing?.id === latest.id

  return (
    <div className="space-y-3">
      <Card>
        <h2 className="section-title mb-2.5">AI Director</h2>
        <p className="mb-2.5 text-[13px] text-secondary">
          AI viết kịch bản và chia cảnh từ ý tưởng. Bạn duyệt trước khi sản xuất.
        </p>
        <div className="flex flex-col gap-2">
          <Field aria-label="Ý tưởng" value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Ý tưởng câu chuyện…" />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Field aria-label="Khán giả" value={audience} onChange={(e) => setAudience(e.target.value)} className="flex-1" />
            <Field aria-label="Giọng điệu" value={tone} onChange={(e) => setTone(e.target.value)} className="flex-1" />
            <Btn
              variant="accent"
              busy={planPending}
              disabled={!idea.trim() || planPending}
              title={idea.trim() ? undefined : 'Vui lòng nhập ý tưởng trước'}
              onClick={() => { createPlan({ idea: idea.trim(), audience, tone }); setIdea('') }}
            >
              Tạo kịch bản
            </Btn>
          </div>
        </div>
        {!idea.trim() ? <p className="mt-2 text-[13px] text-warn">Vui lòng nhập ý tưởng trước.</p> : null}
        {planPending ? <div className="mt-3"><ProgressNote text="AI đang viết kịch bản…" /></div> : null}
        {planError ? (
          <div className="mt-3">
            <ExplainError
              what="Không tạo được kịch bản."
              error={planError}
              todo={
                planError.includes('MODEL') || planError.includes('provider')
                  ? 'Thêm nhà cung cấp và khoá API ở Kho mô hình AI, rồi thử lại.'
                  : 'Thử lại. Nếu vẫn lỗi, kiểm tra nhật ký hoạt động AI.'
              }
              onRetry={onRetryPlan}
            />
          </div>
        ) : null}
      </Card>

      {sorted.length === 0 ? (
        <EmptyState icon="✦" title="Chưa có kịch bản. AI sẽ sinh kịch bản, chia cảnh và lời thoại từ ý tưởng của bạn." />
      ) : (
        <>
          {sorted.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-secondary">Phiên bản</span>
              {sorted.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setViewId(v.id)}
                  className={[
                    'rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors duration-hover',
                    (viewing?.id ?? '') === v.id
                      ? 'border-emberline bg-tint text-ember'
                      : 'border-border bg-surface text-secondary hover:text-ink',
                  ].join(' ')}
                >
                  v{v.version}
                </button>
              ))}
            </div>
          ) : null}

          {isStale ? (
            <p className="rounded-lg border border-emberline bg-tint px-3 py-2 text-[13px] text-ember">
              Bản này đã cũ. Phiên bản mới nhất (v{latest!.version}) đang chờ duyệt.
            </p>
          ) : null}

          <PlanBody plan={viewing!} planActing={planActing} onRefresh={onRefresh} act={act} canDecide={canDecide} />
        </>
      )}
    </div>
  )
}

function PlanBody({
  plan, planActing, act, canDecide, onRefresh,
}: {
  plan: DirectorPlan; planActing: boolean; act: (id: string, a: string, arg?: string) => void
  canDecide: boolean; onRefresh: () => void
}) {
  const p = plan.plan
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(p.title)
  // origin is shown only when we have a real mapping. No badge otherwise.
  const originText = hasEnum(plan.origin, planOriginVi) ? enumVi(plan.origin, planOriginVi) : null
  return (
    <Card className="!p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge value={plan.status} raw={false} />
          <span className="text-xs text-secondary">
            v{plan.version}{originText ? ` · ${originText}` : ''}
          </span>
        </div>
        {plan.mock ? <span className="badge badge-warn">mô phỏng</span> : null}
      </div>
      {editing ? (
        <div className="mt-3 flex gap-2">
          <Field aria-label="Tiêu đề" value={title} onChange={(e) => setTitle(e.target.value)} className="flex-1" />
          <Btn variant="accent" size="sm" onClick={() => { act(plan.id, 'edit', title); setEditing(false); onRefresh() }}>Lưu</Btn>
        </div>
      ) : (
        <h3 className="mt-2 text-lg font-bold tracking-tight">{p.title}</h3>
      )}
      {p.hook ? <p className="mt-2 rounded-lg border-l-2 border-accent bg-bg px-3 py-2 text-[13px] text-secondary">Mở đầu: {p.hook}</p> : null}
      {p.concept ? <p className="mt-2 text-[13px]">Ý tưởng chính: {p.concept}</p> : null}
      {p.scenes && p.scenes.length > 0 ? (
        <ol className="mt-3 space-y-1.5">
          {p.scenes.map((s) => (
            <li key={s.scene_number} className="flex gap-2.5 rounded-lg border border-border bg-bg px-3 py-2 text-[13px]">
              <span className="mono mt-0.5 shrink-0 text-ember">{String(s.scene_number).padStart(2, '0')}</span>
              <span>
                {s.description ?? '(chưa có mô tả)'}
                {s.dialogue ? <span className="text-secondary"> · “{s.dialogue}”</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="mt-3 grid gap-1.5 text-[13px] text-secondary sm:grid-cols-2">
        {p.visual_style ? <p><span className="text-muted">Hình ảnh:</span> {p.visual_style}</p> : null}
        {p.voice_style ? <p><span className="text-muted">Giọng đọc:</span> {p.voice_style}</p> : null}
        {p.duration ? <p><span className="text-muted">Thời lượng:</span> {p.duration}s</p> : null}
        {p.ending ? <p><span className="text-muted">Kết thúc:</span> {p.ending}</p> : null}
        {p.cta ? <p className="sm:col-span-2"><span className="text-muted">Kêu gọi:</span> {p.cta}</p> : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
        {canDecide ? (
          <>
            <Btn variant="accent" size="sm" disabled={planActing} onClick={() => act(plan.id, 'approve')}>Duyệt</Btn>
            <Btn size="sm" disabled={planActing} onClick={() => act(plan.id, 'reject')}>Từ chối</Btn>
          </>
        ) : null}
        <Btn variant="link" onClick={() => setEditing(!editing)}>Sửa tiêu đề</Btn>
        <Btn variant="link" onClick={() => act(plan.id, 'regenerate')}>Tạo lại toàn bộ</Btn>
        <Btn variant="link" onClick={() => act(plan.id, 'section', 'hook')}>Tạo lại mở đầu</Btn>
      </div>
    </Card>
  )
}

/* --------------------------------------------------------------- SCENES */

function ScenesWs({
  projectId, scenes, artifacts, createScene, scenePending, genMedia, genSubtitle, renderScene, onRefresh, onStep,
  characters, addCharacter, characterPending,
}: Pick<WorkspaceProps, 'projectId' | 'scenes' | 'artifacts' | 'createScene' | 'scenePending' | 'genMedia' | 'genSubtitle' | 'renderScene' | 'onRefresh' | 'onStep' | 'characters' | 'addCharacter' | 'characterPending'>) {
  const [order, setOrder] = useState('1')
  const [desc, setDesc] = useState('')
  const [dialogue, setDialogue] = useState('')
  const [visual, setVisual] = useState('')
  const [msg, setMsg] = useState('')
  const [msgCode, setMsgCode] = useState('')

  const run = async (fn: () => Promise<void>) => {
    setMsg('')
    setMsgCode('')
    try {
      await fn()
    } catch (e) {
      const err = e as Error & { code?: string }
      // Human message stays visible; raw code only on hover.
      setMsg(err.message || 'Không thực hiện được')
      setMsgCode(err.code ?? '')
    }
  }

  const kindsFor = (sceneId: string) => artifacts.filter((a) => (a.scene_id ?? null) === sceneId).map((a) => a.kind)

  return (
    <div className="space-y-3">
      <CharacterWs
        characters={characters}
        addCharacter={addCharacter}
        characterPending={characterPending}
      />
      <Card>
        <h2 className="section-title">Cảnh ({scenes.length})</h2>
        {scenes.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-border bg-panel px-4 py-6 text-center">
            <p className="text-[13px] font-medium text-secondary">Chưa có cảnh.</p>
            <p className="mt-1.5 text-[13px] text-muted">
              Duyệt kế hoạch không tự sinh cảnh. Bạn có thể tạo thủ công, hoặc bật Auto Pilot để nhà máy tạo tự động.
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Btn size="sm" onClick={() => document.getElementById('new-scene')?.scrollIntoView({ block: 'center' })}>Tạo cảnh thủ công</Btn>
              <Link to="/autopilot" className="btn btn-ghost px-2.5 py-1 text-[13px]">Bật Auto Pilot</Link>
            </div>
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {scenes.map((s) => {
              const mine = kindsFor(s.id)
              const canRender = mine.includes('IMAGE') && mine.includes('TTS')
              return (
                <li key={s.id} className="rounded-xl border border-border bg-bg p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="mono mr-1.5 text-ember">#{s.order}</span>
                        {s.description || '(chưa có mô tả)'}
                      </p>
                      {s.dialogue ? <p className="mt-1 text-[13px] text-secondary">“{s.dialogue}”</p> : null}
                      {s.visual_prompt ? <p className="mt-1 text-[12px] text-muted">Gợi ý hình: {s.visual_prompt}</p> : null}
                      {s.camera ? <p className="mono mt-0.5 text-[11px] text-muted">{s.camera}{s.duration_s ? ` · ${s.duration_s}s` : ''}</p> : null}
                    </div>
                    <StatusBadge value={s.status} label={enumVi(s.status, sceneStatusVi)} raw={false} className="shrink-0" />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {[['IMAGE', 'Hình'], ['TTS', 'Giọng'], ['SUBTITLE', 'Phụ đề'], ['VIDEO', 'Video']].map(([k, lbl]) => (
                      <span key={k} className={`badge ${mine.includes(k) ? 'badge-ok' : 'badge-info'}`}>{lbl}</span>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Btn size="sm" onClick={() => run(() => genMedia(s.id, 'image'))}>Tạo hình</Btn>
                    <Btn size="sm" onClick={() => run(() => genMedia(s.id, 'tts'))}>Tạo giọng đọc</Btn>
                    <Btn size="sm" onClick={() => run(() => genSubtitle(s.id))}>Tạo phụ đề</Btn>
                    <Btn
                      size="sm"
                      variant="accent"
                      disabled={!canRender}
                      title={canRender ? undefined : 'Cần có hình và giọng đọc trước khi dựng cảnh'}
                      onClick={() => run(() => renderScene(s.id))}
                    >
                      Dựng cảnh
                    </Btn>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {msg ? <p className="mt-2 text-[13px] text-red-300" title={msgCode || undefined}>{msg}</p> : null}
      </Card>

      <Card>
        <h2 className="section-title mb-2.5">Tạo cảnh thủ công</h2>
        <div id="new-scene" className="grid gap-2 sm:grid-cols-2">
          <Field aria-label="Thứ tự" type="number" value={order} onChange={(e) => setOrder(e.target.value)} placeholder="Thứ tự" />
          <Field aria-label="Mô tả cảnh" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Mô tả cảnh" />
          <Field aria-label="Lời thoại" value={dialogue} onChange={(e) => setDialogue(e.target.value)} placeholder="Lời thoại (tuỳ chọn)" />
          <Field aria-label="Gợi ý hình" value={visual} onChange={(e) => setVisual(e.target.value)} placeholder="Gợi ý hình (tuỳ chọn)" />
        </div>
        <Btn
          className="mt-2"
          variant="accent"
          busy={scenePending}
          disabled={!desc.trim() || scenePending}
          onClick={() => { createScene({ order: Number(order) || 1, description: desc, dialogue, visual_prompt: visual, camera: '', status: 'DRAFT' }); setDesc(''); setDialogue(''); setVisual('') }}
        >
          Tạo cảnh
        </Btn>
        <p className="mt-2 text-[12px] text-muted">
          Cảnh tạo tay không tự sinh media. Sang tab Media để tạo hình, giọng đọc và phụ đề.
        </p>
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------ QC / GATE */

const CHECK_VI: Record<string, string> = {
  video_exists: 'Có video', video_readable: 'Video đọc được', video_duration: 'Thời lượng video',
  resolution: 'Độ phân giải', audio_exists: 'Có âm thanh', audio_duration: 'Thời lượng âm thanh',
  subtitle_exists: 'Có phụ đề', subtitle_timing: 'Định thời phụ đề', artifact_integrity: 'Tính toàn vẹn tệp',
  character_policy: 'Chính sách nhân vật', license: 'Giấy phép / chi phí', disclosure: 'Công bố nội dung',
  provenance: 'Nguồn gốc',
}

function QcWs({ qc, qcPending, qcError, runQc }: Pick<WorkspaceProps, 'qc' | 'qcPending' | 'qcError' | 'runQc'>) {
  return (
    <Card>
      <h2 className="section-title">Kiểm định</h2>
      {!qc ? (
        <>
          <p className="mt-1 text-[13px] text-secondary">
            Chưa có kết quả kiểm định.
          </p>
          <p className="mt-1 text-[13px] text-muted">
            Kiểm định kiểm video, âm thanh, phụ đề, thời lượng, độ phân giải, chính sách nhân vật, giấy phép và nguồn gốc.
            Backend không lưu kết quả, nên kết quả chỉ có trong lần xem hiện tại.
          </p>
          {qcError ? <p className="mt-2 text-[13px] text-red-300">{qcError}</p> : null}
          <Btn variant="accent" className="mt-3" busy={qcPending} disabled={qcPending} onClick={runQc}>Chạy kiểm định</Btn>
        </>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[13px] text-secondary">Kết quả:</span>
            <StatusBadge value={qc.qc.verdict} raw={false} />
          </div>
          <ul className="mt-3 space-y-1">
            {qc.qc.checks.map((c) => (
              <li key={c.key} className="flex items-start gap-2 border-b border-border/50 py-1 text-[13px] last:border-0">
                <span className={[
                  'mt-0.5 w-3 shrink-0 text-[11px]',
                  c.status === 'PASS' ? 'text-ok' : c.status === 'REVIEW' ? 'text-warn' : 'text-bad',
                ].join(' ')}>
                  {c.status === 'PASS' ? '✓' : c.status === 'REVIEW' ? '⚠' : '✕'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-ink">{CHECK_VI[c.key] ?? enumVi(c.key, {})}</span>
                  {c.detail ? <span className="text-secondary"> — {c.detail}</span> : null}
                  <span className="ml-1.5 text-[11px] text-muted">({enumVi(c.status, qcCheckVi)})</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

function GateWs({
  qc, qcPending, qcError, runQc, exportProject, busyStep, onStepBusy, onRefresh,
}: Pick<WorkspaceProps, 'qc' | 'qcPending' | 'qcError' | 'runQc' | 'exportProject' | 'busyStep' | 'onStepBusy' | 'onRefresh'>) {
  const [msg, setMsg] = useState('')
  const passed = qc?.gate.decision === 'PASS'
  const go = async () => {
    onStepBusy('GATE')
    setMsg('')
    try {
      const res = await exportProject()
      setMsg(`Đã xuất: ${res}`)
      onRefresh()
    } catch (e) {
      const err = e as Error & { code?: string }
      setMsg(`${err.code ?? 'ERROR'}: ${err.message}`)
    } finally { onStepBusy(null) }
  }
  return (
    <div className="space-y-3">
      <Card>
        <h2 className="section-title">Cổng sản xuất</h2>
        {!qc ? (
          <>
            <p className="mt-1 text-[13px] text-secondary">Chưa có kết quả kiểm định, chưa thể đánh giá cổng.</p>
            <Btn size="sm" className="mt-2" busy={qcPending} disabled={qcPending} onClick={runQc}>Chạy kiểm định</Btn>
          </>
        ) : (
          <>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[13px] text-secondary">Quyết định:</span>
              <StatusBadge value={passed ? 'PASS' : 'BLOCKED'} raw={false} />
            </div>
            {!passed ? (
              <div className="mt-3">
                <p className="text-[13px] font-medium text-warn">Cổng sản xuất chưa đạt</p>
                <ul className="mt-1.5 space-y-0.5 text-[13px] text-secondary">
                  {qc.gate.reasons.map((r, i) => <li key={i} className="mono">✕ {r}</li>)}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </Card>

      <Card>
        <h2 className="section-title mb-1">Xuất tệp</h2>
        <p className="text-[13px] text-secondary">
          {passed
            ? 'Cổng sản xuất đã đạt. Có thể xuất tệp.'
            : 'Xuất tệp bị khoá cho tới khi Cổng sản xuất đạt. Nhà máy không cho vượt cổng.'}
        </p>
        <Btn
          variant="accent"
          className="mt-3"
          disabled={!passed || busyStep === 'GATE'}
          title={passed ? undefined : 'Cổng sản xuất chưa đạt'}
          onClick={go}
        >
          {busyStep === 'GATE' ? <SpinnerSm /> : null} Xuất tệp
        </Btn>
        {msg ? <p className="mt-2 text-[13px] text-secondary">{msg}</p> : null}
      </Card>
    </div>
  )
}

/* ---------------------------------------------------------- SCHEDULE */

function ScheduleWs({
  schedules, createSchedule, schedulePending, cancelSchedule,
}: Pick<WorkspaceProps, 'schedules' | 'createSchedule' | 'schedulePending' | 'cancelSchedule'>) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('20:00')
  const [msg, setMsg] = useState('')

  return (
    <div className="space-y-3">
      <Card>
        <h2 className="section-title mb-2.5">Lịch đăng ({schedules.length})</h2>
        {schedules.length === 0 ? (
          <p className="text-[13px] text-secondary">Chưa có lịch đăng nào.</p>
        ) : (
          <ul className="space-y-1.5">
            {schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-bg px-3 py-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">{s.run_at.replace('T', ' ').slice(0, 16)}</p>
                  <p className="mono text-[11px] text-muted">
                    {s.platforms.join(', ') || '—'}{s.timezone ? ` · ${s.timezone}` : ''}{s.recurrence ? ` · lặp ${s.recurrence}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge value={s.status} raw={false} className="shrink-0" />
                  {(s.status === 'SCHEDULED' || s.status === 'MISSED') ? (
                    <Btn variant="link" onClick={() => cancelSchedule(s.id)}>Huỷ</Btn>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {msg ? <p className="mt-2 text-[13px] text-red-300">{msg}</p> : null}
      </Card>

      <Card>
        <h2 className="section-title mb-2.5">Thêm lịch</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Field aria-label="Ngày" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Field aria-label="Giờ" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="max-w-32" />
          <Btn
            variant="accent"
            busy={schedulePending}
            disabled={!date || schedulePending}
            onClick={() => { setMsg(''); createSchedule({ date, time, platforms: ['youtube'] }) }}
          >
            Lên lịch
          </Btn>
        </div>
        <p className="mono mt-2 text-[11px] text-muted">Asia/Ho_Chi_Minh · nền tảng: YouTube</p>
      </Card>
    </div>
  )
}

/* ---------------------------------------------------------- PUBLISH */

function PublishWs() {
  return (
    <Card>
      <h2 className="section-title">Đăng bài</h2>
      <p className="mt-2 text-[13px] text-secondary">Chưa khả dụng.</p>
      <p className="mt-1 text-[13px] text-muted">
        Chưa có API đọc lịch sử đăng theo dự án. Nhà máy không hiển thị trạng thái đăng khi chưa có dữ liệu thật.
      </p>
      <Link to="/publisher" className="link-accent mt-3 inline-block text-[13px]">Mở Bộ đăng bài</Link>
    </Card>
  )
}

/* ------------------------------------------------------------ CHARACTER */

function CharacterWs({
  characters, addCharacter, characterPending,
}: Pick<WorkspaceProps, 'characters' | 'addCharacter' | 'characterPending'>) {
  const [name, setName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [target, setTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState<unknown>(null)

  const call = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true); setErr(null); setMsg('')
    try { await fn(); setMsg(okMsg) } catch (e) { setErr(e) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <Card>
        <h2 className="section-title mb-1">Nhân vật chính ({characters.length})</h2>
        <p className="text-[13px] text-secondary">
          Nhân vật dùng chung cho mọi cảnh. Bạn tự khoá hình mẫu khi đã ưng ý — nhà máy không tự xác minh khuôn mặt.
        </p>
        {characters.length === 0 ? (
          <p className="mt-3 text-[13px] text-secondary">Chưa có nhân vật. Thêm nhân vật chính để AI Director dùng làm nhất quán.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {characters.map((c) => (
              <li key={c.id} className="rounded-lg border border-border bg-bg px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold">{c.name}</p>
                  <StatusBadge
                    value={c.lock_state}
                    label={enumVi(c.lock_state, lockStateVi)}
                    raw={false}
                    className="shrink-0"
                  />
                </div>
                {c.visual_identity ? <p className="mt-1 text-[12px] text-muted">{c.visual_identity}</p> : null}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[12px] text-muted">
                    {c.reference_asset_id ? 'Đã có hình mẫu' : 'Chưa có hình mẫu'}
                  </span>
                  <Btn size="sm" disabled={busy} onClick={() => { setTarget(c.id); fileRef.current?.click() }}>Tải hình mẫu</Btn>
                  {c.lock_state === 'LOCKED' ? (
                    <Btn size="sm" disabled={busy} onClick={() => call(() => api.updateCharacter(c.id, { lock_state: 'REVIEW_REQUIRED' }), 'Đã mở khoá nhân vật.')}>
                      Mở khoá
                    </Btn>
                  ) : (
                    <Btn size="sm" disabled={busy} onClick={() => call(() => api.updateCharacter(c.id, { lock_state: 'LOCKED' }), 'Đã khoá nhân vật.')}>
                      Khoá
                    </Btn>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          data-testid="ref-input"
          onChange={(e) => {
            const file = e.target.files?.[0]
            const cid = target
            e.target.value = ''
            if (file && cid) call(() => api.uploadCharacterReference(cid, file), 'Đã tải hình mẫu.')
          }}
        />
        {msg ? <p className="mt-2 text-[13px] text-secondary">{msg}</p> : null}
        {err ? (
          <div className="mt-2">
            <ExplainError
              what="Không cập nhật được nhân vật."
              error={err}
              todo="Thử lại. Ảnh mẫu chỉ nhận PNG, JPEG hoặc WEBP."
              onRetry={() => setErr(null)}
            />
          </div>
        ) : null}
        <div className="mt-3 flex gap-2 border-t border-border pt-3">
          <Field aria-label="Tên nhân vật" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên nhân vật…" className="flex-1" />
          <Btn
            size="sm"
            busy={characterPending}
            disabled={!name.trim() || characterPending}
            onClick={() => { addCharacter(name.trim()); setName('') }}
          >
            Thêm
          </Btn>
        </div>
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------ DISPATCH */

export function Workspace(props: WorkspaceProps) {
  const { activeStep } = props
  switch (activeStep) {
    case 'IDEA': return <IdeaWs {...props} p={props.project} />
    case 'DIRECTOR': return <DirectorWs {...props} />
    case 'SCENES': return <ScenesWs {...props} />
    case 'MEDIA': return (
      <ArtifactList
        title="Media"
        hint="Hình minh hoạ và video của từng cảnh. Nhà máy chưa có API xem trước tệp nên chỉ hiện thông tin tệp."
        artifacts={props.artifacts.filter((a) => a.kind === 'IMAGE' || a.kind === 'VIDEO')}
        scenes={props.scenes}
        emptyTitle={
          props.scenes.length === 0
            ? 'Chưa có cảnh, chưa thể tạo hình ảnh.'
            : props.scenes.some((s) => !props.artifacts.some((a) => (a.scene_id ?? null) === s.id && a.kind === 'IMAGE'))
              ? 'Chưa có hình ảnh cho một số cảnh.'
              : 'Chưa có hình ảnh.'
        }
        actions={(s) => (
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn size="sm" onClick={() => props.genMedia(s.id, 'image').catch(() => undefined)}>Tạo hình</Btn>
            <Btn size="sm" onClick={() => props.genMedia(s.id, 'video').catch(() => undefined)}>Tạo video cảnh</Btn>
          </div>
        )}
      />
    )
    case 'TTS': return (
      <ArtifactList
        title="TTS"
        hint="Audio giọng đọc của từng cảnh."
        artifacts={props.artifacts.filter((a) => a.kind === 'TTS')}
        scenes={props.scenes}
        emptyTitle={
          props.scenes.length === 0
            ? 'Chưa có cảnh, chưa thể tạo giọng đọc.'
            : 'Chưa có giọng đọc.'
        }
        actions={(s) => <div className="mt-2"><Btn size="sm" onClick={() => props.genMedia(s.id, 'tts').catch(() => undefined)}>Tạo giọng đọc</Btn></div>}
      />
    )
    case 'SUBTITLE': return (
      <ArtifactList
        title="Phụ đề"
        hint="File phụ đề của từng cảnh."
        artifacts={props.artifacts.filter((a) => a.kind === 'SUBTITLE')}
        scenes={props.scenes}
        emptyTitle={
          props.scenes.length === 0
            ? 'Chưa có cảnh, chưa thể tạo phụ đề.'
            : 'Chưa có phụ đề.'
        }
        actions={(s) => <div className="mt-2"><Btn size="sm" onClick={() => props.genSubtitle(s.id).catch(() => undefined)}>Tạo phụ đề</Btn></div>}
      />
    )
    case 'RENDER': {
      const sceneVideos = props.artifacts.filter((a) => a.kind === 'VIDEO' && a.scene_id)
      const output = props.artifacts.find((a) => a.kind === 'VIDEO' && !a.scene_id)
      const ready = props.scenes.filter((s) => {
        const mine = props.artifacts.filter((a) => (a.scene_id ?? null) === s.id).map((a) => a.kind)
        return mine.includes('IMAGE') && mine.includes('TTS')
      })
return (
    <div className="space-y-3">
      <Card>
            <h2 className="section-title mb-1">Dựng video</h2>
            <p className="text-[13px] text-secondary">
              {props.busyStep === 'RENDER' ? 'Đang dựng video' : `${ready.length}/${props.scenes.length} cảnh đủ điều kiện dựng (cần hình và giọng đọc).`}
            </p>
            <Btn
              variant="accent"
              className="mt-2"
              disabled={ready.length === 0 || props.busyStep === 'RENDER'}
              title={ready.length === 0 ? 'Cần hình và giọng đọc cho ít nhất một cảnh' : undefined}
              onClick={() => { props.onStepBusy('RENDER'); props.renderProject().catch(() => undefined).finally(() => props.onStepBusy(null)) }}
            >
              Dựng toàn bộ dự án
            </Btn>
            <p className="mt-2 text-[12px] text-muted">Nhà máy không công bố phần trăm dựng vì backend không cung cấp tiến trình theo từng bước.</p>
          </Card>

          <ArtifactList
            title="Video cảnh"
            artifacts={sceneVideos}
            scenes={props.scenes}
            emptyTitle="Chưa có video dựng."
            emptyHint="Dựng cảnh cần có hình và giọng đọc trước."
            actions={(s) => {
              const mine = props.artifacts.filter((a) => (a.scene_id ?? null) === s.id).map((a) => a.kind)
              const can = mine.includes('IMAGE') && mine.includes('TTS')
              return (
                <div className="mt-2">
                  <Btn size="sm" variant="accent" disabled={!can} onClick={() => props.renderScene(s.id).catch(() => undefined)}>Dựng cảnh</Btn>
                </div>
              )
            }}
          />

          <Card>
            <h2 className="section-title mb-1">Đầu ra dự án</h2>
            {output ? (
              <>
                <p className="mono text-[13px] text-secondary">
                  {output.width}×{output.height} · {output.duration_s?.toFixed(1) ?? '?'}s · {bytes(output.bytes)}
                </p>
                <a
                  href={api.artifactUrl(output.id)}
                  download={output.path.split('/').pop() || 'final.mp4'}
                  className="link-accent mt-1.5 inline-block text-[13px]"
                >
                  Tải video xuống
                </a>
              </>
            ) : (
              <p className="text-[13px] text-secondary">Chưa có video dự án.</p>
            )}
          </Card>
        </div>
      )
    }
    case 'QC': return <QcWs {...props} />
    case 'GATE': return <GateWs {...props} />
    case 'SCHEDULE': return <ScheduleWs {...props} />
    case 'PUBLISH': return <PublishWs />
    default: return <ErrorState message="Bước không xác định" />
  }
}
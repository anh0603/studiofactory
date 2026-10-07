import type { StepId, StepState, WorkflowNode } from '../story/workflow'

/* Production workflow strip. Renders state only — no actions, no fake progress. */

type IconProps = { className?: string }
const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function IconIdea(p: IconProps) {
  return <svg viewBox="0 0 20 20" className={p.className} aria-hidden="true"><path {...s} d="M10 2.5a5 5 0 0 0-3 9v1.5h6V11.5a5 5 0 0 0-3-9Z" /><path {...s} d="M8.5 16h3" /></svg>
}
function IconDirector(p: IconProps) {
  return <svg viewBox="0 0 20 20" className={p.className} aria-hidden="true"><circle {...s} cx="10" cy="10" r="2" /><path {...s} d="M10 3v2M10 15v2M3 10h2M15 10h2M5.2 5.2l1.4 1.4M13.4 13.4l1.4 1.4M14.8 5.2l-1.4 1.4M6.6 13.4l-1.4 1.4" /></svg>
}
function IconScenes(p: IconProps) {
  return <svg viewBox="0 0 20 20" className={p.className} aria-hidden="true"><rect {...s} x="2.5" y="4" width="15" height="12" rx="1.5" /><path {...s} d="M2.5 8h15M7 4v4M13 4v4" /></svg>
}
function IconMedia(p: IconProps) {
  return <svg viewBox="0 0 20 20" className={p.className} aria-hidden="true"><rect {...s} x="2.5" y="4" width="15" height="12" rx="1.5" /><circle {...s} cx="7" cy="8" r="1.3" /><path {...s} d="M3 14l4-3.5 3 2.5 3-2.5 4 3.5" /></svg>
}
function IconTts(p: IconProps) {
  return <svg viewBox="0 0 20 20" className={p.className} aria-hidden="true"><path {...s} d="M4 8v4h3l4 3.5v-11L7 8H4Z" /><path {...s} d="M14 7.5a3.5 3.5 0 0 1 0 5M16 5.5a6.5 6.5 0 0 1 0 9" /></svg>
}
function IconSubtitle(p: IconProps) {
  return <svg viewBox="0 0 20 20" className={p.className} aria-hidden="true"><rect {...s} x="2.5" y="4.5" width="15" height="11" rx="1.5" /><path {...s} d="M6 9h4M10.5 9h3.5M6 12.5h2.5M11 12.5h3" /></svg>
}
function IconRender(p: IconProps) {
  return <svg viewBox="0 0 20 20" className={p.className} aria-hidden="true"><rect {...s} x="2.5" y="4" width="15" height="12" rx="1.5" /><path {...s} d="M8 7.5 13 10l-5 2.5z" /></svg>
}
function IconQc(p: IconProps) {
  return <svg viewBox="0 0 20 20" className={p.className} aria-hidden="true"><path {...s} d="M10 2.8l5.5 2.2v4.6c0 3.3-2.3 6.3-5.5 7.6-3.2-1.3-5.5-4.3-5.5-7.6V5L10 2.8Z" /><path {...s} d="M7.6 10l1.8 1.8L12.8 8.4" /></svg>
}
function IconGate(p: IconProps) {
  return <svg viewBox="0 0 20 20" className={p.className} aria-hidden="true"><path {...s} d="M3.5 6.5h13M3.5 13.5h13" /><path {...s} d="M6 4v5M14 11v5" /><path {...s} d="M6 6.5h8M6 13.5h8" /></svg>
}
function IconSchedule(p: IconProps) {
  return <svg viewBox="0 0 20 20" className={p.className} aria-hidden="true"><rect {...s} x="3" y="4.5" width="14" height="12" rx="1.5" /><path {...s} d="M3 8.5h14M7 2.8v3M13 2.8v3" /></svg>
}
function IconPublish(p: IconProps) {
  return <svg viewBox="0 0 20 20" className={p.className} aria-hidden="true"><path {...s} d="M10 15V4" /><path {...s} d="M6.5 7.5 10 4l3.5 3.5" /><path {...s} d="M4 13v3a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3" /></svg>
}

const ICONS: Record<StepId, (p: IconProps) => JSX.Element> = {
  IDEA: IconIdea, DIRECTOR: IconDirector, SCENES: IconScenes, MEDIA: IconMedia,
  TTS: IconTts, SUBTITLE: IconSubtitle, RENDER: IconRender, QC: IconQc,
  GATE: IconGate, SCHEDULE: IconSchedule, PUBLISH: IconPublish,
}

/** Vietnamese state wording. Raw enums never reach the user. */
export const STATE_LABEL: Record<StepState, string> = {
  COMPLETED: 'Hoàn thành',
  RUNNING: 'Đang xử lý',
  WAITING: 'Chờ',
  REVIEW: 'Cần duyệt',
  BLOCKED: 'Bị chặn',
  FAILED: 'Thất bại',
  UNAVAILABLE: 'Chưa khả dụng',
}

const NODE_TONE: Record<StepState, string> = {
  COMPLETED: 'text-ok',
  RUNNING: 'text-accent',
  REVIEW: 'text-warn',
  BLOCKED: 'text-bad',
  FAILED: 'text-bad',
  WAITING: 'text-muted',
  UNAVAILABLE: 'text-muted',
}

function Marker({ state }: { state: StepState }) {
  if (state === 'COMPLETED') return <span className="text-[11px] leading-none">✓</span>
  if (state === 'RUNNING') {
    return (
      <span
        aria-hidden="true"
        data-testid="pulse"
        className="h-1.5 w-1.5 rounded-full bg-accent animate-dot-pulse"
      />
    )
  }
  if (state === 'BLOCKED' || state === 'FAILED') return <span className="text-[11px] leading-none">✕</span>
  if (state === 'REVIEW') return <span className="text-[11px] leading-none">●</span>
  if (state === 'UNAVAILABLE') return <span className="text-[11px] leading-none">–</span>
  return <span className="h-1.5 w-1.5 rounded-full border border-current" />
}

export function WorkflowStrip({
  nodes, activeStep, nextStep, onSelect,
}: {
  nodes: WorkflowNode[]
  activeStep: StepId
  nextStep: StepId | null
  onSelect?: (id: StepId) => void
}) {
  return (
    <div className="border-y border-border bg-surface/40 px-3 py-3 md:px-5">
      <ol className="flex items-stretch" data-testid="workflow-strip">
        {nodes.map((n, i) => {
          const Icon = ICONS[n.id]
          const isActive = n.id === activeStep
          const isNext = nextStep === n.id
          const done = n.state === 'COMPLETED'
          return (
            <li key={n.id} className="flex min-w-0 flex-1 items-center">
              <button
                type="button"
                data-testid={`node-${n.id}`}
                data-state={n.state}
                onClick={() => onSelect?.(n.id)}
                title={`${n.label} · ${STATE_LABEL[n.state]}${n.detail ? ` · ${n.detail}` : ''}`}
                aria-current={isActive ? 'step' : undefined}
                className={[
                  'flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-center',
                  'transition-colors duration-hover ease-out',
                  isActive ? 'bg-elevated' : 'hover:bg-raised',
                ].join(' ')}
              >
                <span className={['flex items-center gap-1.5', isNext ? 'text-accent' : ''].join(' ')}>
                  <Icon className={['h-[15px] w-[15px] shrink-0', isActive || isNext ? 'text-accent' : NODE_TONE[n.state]].join(' ')} />
                  <Marker state={n.state} />
                </span>
                <span
                  className={[
                    'w-full truncate text-[11.5px] font-semibold leading-tight',
                    isActive ? 'text-ink' : 'text-secondary',
                  ].join(' ')}
                >
                  {n.label}
                </span>
                <span className="flex h-3.5 items-center">
                  {n.count ? (
                    <span className="mono text-[10.5px] text-secondary">{n.count}</span>
                  ) : null}
                </span>
                {isNext ? <span className="text-[9.5px] font-bold uppercase tracking-wide text-accent">tiếp</span> : <span className="h-[11px]" />}
              </button>
              {i < nodes.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={[
                    'mx-0.5 h-px w-2 shrink-0 self-center transition-colors duration-state',
                    done ? 'bg-ok' : 'bg-border',
                  ].join(' ')}
                />
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** Vertical variant for narrow screens. Same data, no horizontal scrolling. */
export function WorkflowStepper({
  nodes, activeStep, nextStep, onSelect,
}: {
  nodes: WorkflowNode[]
  activeStep: StepId
  nextStep: StepId | null
  onSelect?: (id: StepId) => void
}) {
  const completed = nodes.filter((n) => n.state === 'COMPLETED').length
  return (
    <div className="border-y border-border bg-surface/40 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-secondary">Quy trình</p>
        <p className="mono text-[11px] text-secondary">{completed} / {nodes.length}</p>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-panel">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-state ease-out"
          style={{ width: `${nodes.length ? (completed / nodes.length) * 100 : 0}%` }}
        />
      </div>
      <ul className="mt-3 space-y-0.5">
        {nodes.map((n) => {
          const Icon = ICONS[n.id]
          const isActive = n.id === activeStep
          const isNext = nextStep === n.id
          return (
            <li key={n.id}>
              <button
                type="button"
                data-testid={`step-${n.id}`}
                data-state={n.state}
                aria-current={isActive ? 'step' : undefined}
                onClick={() => onSelect?.(n.id)}
                className={[
                  'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-hover ease-out',
                  isActive ? 'bg-elevated' : 'hover:bg-raised',
                ].join(' ')}
              >
                <Icon className={['h-4 w-4 shrink-0', isActive || isNext ? 'text-accent' : NODE_TONE[n.state]].join(' ')} />
                <Marker state={n.state} />
                <span className={['flex-1 truncate text-[13px]', isActive ? 'font-semibold text-ink' : 'text-secondary'].join(' ')}>
                  {n.label}
                </span>
                {n.count ? <span className="mono shrink-0 text-[11px] text-secondary">{n.count}</span> : null}
                {isNext ? <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-accent">tiếp</span> : null}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
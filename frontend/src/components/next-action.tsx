import type { NextAction } from '../story/workflow'

/**
 * One decision, one activity, or one waiting reason. Never a wall of buttons.
 * The resolver decides; this component only presents.
 */

const HEAD = {
  DECISION: 'Việc cần bạn quyết',
  ACTIVITY: 'Đang xử lý',
  WAITING: 'Đang chờ',
  NONE: '',
} as const

const HEAD_TONE = {
  DECISION: 'text-accent',
  ACTIVITY: 'text-ok',
  WAITING: 'text-warn',
  NONE: 'text-secondary',
} as const

export function NextActionBar({
  action, onIntent, children,
}: {
  action: NextAction
  onIntent?: (intent: string) => void
  children?: React.ReactNode
}) {
  if (action.kind === 'NONE') return null
  return (
    <div
      data-testid="next-action"
      data-kind={action.kind}
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl border border-border bg-surface px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <p className={['text-[11px] font-bold uppercase tracking-[0.09em]', HEAD_TONE[action.kind]].join(' ')}>
          {HEAD[action.kind]}
        </p>
        <p className="mt-1 text-[14px] font-semibold leading-snug text-ink">{action.title}</p>
        {action.detail ? <p className="mt-0.5 text-[13px] leading-relaxed text-secondary">{action.detail}</p> : null}
      </div>
      <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
        {children}
        {action.ctas.map((cta, i) => (
          <button
            key={cta.intent}
            type="button"
            data-testid={`cta-${cta.intent}`}
            onClick={() => onIntent?.(cta.intent)}
            className={['btn w-full sm:w-auto', i === 0 ? 'btn-accent' : 'btn-ghost'].join(' ')}
          >
            {cta.label}
          </button>
        ))}
      </div>
    </div>
  )
}
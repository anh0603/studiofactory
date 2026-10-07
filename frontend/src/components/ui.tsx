import { Button as HeroButton, Skeleton as HeroSkeleton, Spinner as HeroSpinner } from '@heroui/react'
import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react'
import { statusVi } from '../i18n/strings.vi'

/* Shared design primitives. Same props/API as before — visual layer only. */

const STATUS_BADGE: Record<string, string> = {
  SUCCEEDED: 'badge-ok', CONFIRMED_PUBLISHED: 'badge-ok', PASS: 'badge-ok',
  ACTIVE: 'badge-ok', HEALTHY: 'badge-ok', CONNECTED: 'badge-ok', APPROVED: 'badge-ok',
  COMPLETED: 'badge-ok', CAPABILITY_VERIFIED: 'badge-ok', EXPORTED: 'badge-ok', READY: 'badge-ok',
  RUNNING: 'badge-accent', QUEUED: 'badge-accent', SCHEDULED: 'badge-accent',
  SENDING: 'badge-accent', CLAIMED: 'badge-accent', DISPATCHED: 'badge-accent',
  AWAITING_APPROVAL: 'badge-accent', REVIEW: 'badge-accent', REVIEW_REQUIRED: 'badge-accent',
  PAUSED: 'badge-warn', RETRYABLE_ERROR: 'badge-warn', MISSED: 'badge-warn',
  DEGRADED: 'badge-warn', RATE_LIMITED: 'badge-warn', AUTHENTICATED: 'badge-warn',
  FAILED: 'badge-bad', BLOCKED: 'badge-bad', FATAL_ERROR: 'badge-bad',
  CANCELLED: 'badge-bad', REJECTED: 'badge-bad', UNAVAILABLE: 'badge-bad',
  AUTH_FAILED: 'badge-bad', NOT_CONNECTED: 'badge-bad',
  NOT_RUNNING: 'badge-bad', ERROR: 'badge-bad',
}

/** Only real in-flight states pulse. Everything else stays still. */
const PULSING = new Set(['RUNNING', 'SENDING', 'CLAIMED', 'PUBLISHING'])
/** Needs a human decision — cue, not a loop. */
const NEEDS_ACTION = new Set(['AWAITING_APPROVAL', 'REVIEW', 'REVIEW_REQUIRED'])

/**
 * Unknown enum -> "Chưa khả dụng", never the raw code. The raw value stays in
 * `title` so it can still be looked up without appearing on screen.
 *
 * `label` overrides the generic statusVi lookup. Needed because the same enum
 * string can mean different things per domain: scene.status REVIEW_REQUIRED is
 * "Cần duyệt" while character.lock_state REVIEW_REQUIRED is "Cần xem lại".
 */
export function StatusBadge({
  value, className = '', raw = true, label,
}: { value: string; className?: string; raw?: boolean; label?: string }) {
  const tone = STATUS_BADGE[value] ?? 'badge-info'
  const dot =
    tone === 'badge-ok' ? 'bg-emerald-400' : tone === 'badge-warn' ? 'bg-amber-400' : tone === 'badge-bad' ? 'bg-red-400' : tone === 'badge-accent' ? 'bg-accent' : 'bg-muted'
  const generic = statusVi[value.toUpperCase()]
  const known = !!label || !!generic
  const text = label ?? generic ?? 'Chưa khả dụng'
  const pulsing = PULSING.has(value)
  const needsAction = NEEDS_ACTION.has(value)
  return (
    <span className={`badge animate-state-swap ${tone} ${className}`} title={value}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${pulsing ? 'animate-dot-pulse' : ''}`} />
      {text}
      {raw && known && value !== text ? <span className="font-mono text-[10px] font-normal opacity-70">{value}</span> : null}
      {needsAction ? <span aria-hidden="true" className="text-[10px] leading-none">•</span> : null}
    </span>
  )
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'accent' | 'ghost' | 'danger' | 'link'
  size?: 'md' | 'sm'
  busy?: boolean
}

export function Btn({ variant = 'ghost', size = 'md', className = '', children, busy, disabled, onClick, type, title }: BtnProps) {
  if (variant === 'link') {
    return (
      <HeroButton
        variant="light"
        color="primary"
        size={size === 'sm' ? 'sm' : 'md'}
        isLoading={busy || undefined}
        isDisabled={disabled || undefined}
        onClick={onClick as never}
        type={type}
        title={title}
        className={`h-auto min-w-0 gap-1 px-1.5 py-1 text-[13px] font-semibold ${className}`}
      >
        {children}
      </HeroButton>
    )
  }
  const color = variant === 'accent' ? 'primary' : variant === 'danger' ? 'danger' : 'default'
  const heroVariant = variant === 'accent' ? 'shadow' : 'bordered'
  return (
    <HeroButton
      color={color as never}
      variant={heroVariant as never}
      size={size === 'sm' ? 'sm' : 'md'}
      isLoading={busy || undefined}
      isDisabled={disabled || undefined}
      onClick={onClick as never}
      type={type}
      title={title}
      className={`font-semibold ${variant === 'ghost' ? 'border-border bg-raised text-ink' : ''} ${className}`}
    >
      {children}
    </HeroButton>
  )
}

export function Card({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={`card ${className}`}>{children}</div>
}

export const Field = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Field({ className, ...props }, ref) {
    return <input ref={ref} {...props} className={`field ${className ?? ''}`} />
  },
)

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`field ${props.className ?? ''}`} />
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {sub ? <p className="page-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Stat({ label, value, sub, icon }: { label: string; value: React.ReactNode; sub?: string; icon?: React.ReactNode }) {
  return (
    <div className="card group">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-secondary">{label}</p>
        {icon ? <span className="stat-ic">{icon}</span> : null}
      </div>
      <p className="mt-1.5 text-[26px] font-extrabold leading-none tracking-tight">{value}</p>
      {sub ? <p className="mono mt-1.5 text-muted">{sub}</p> : null}
    </div>
  )
}

/** Inline spinner. Only for short actions and small requests. */
export function SpinnerSm({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex shrink-0 ${className}`} aria-hidden="true">
      <HeroSpinner size="sm" color="current" />
    </span>
  )
}

/** Skeleton block. Preferred over a full-area spinner. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <HeroSkeleton className={`rounded-lg ${className}`} />
}

export function SkeletonList({ rows = 3, className = '' }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Đang tải" className={`space-y-2 ${className}`}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-[58px] w-full" />
      ))}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2.5 py-6 text-secondary">
      <HeroSpinner size="sm" color="current" />
      <span className="text-sm">{label ?? 'Đang tải…'}</span>
    </div>
  )
}

export function ProgressNote({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-bg px-3 py-2.5 text-[13px] text-secondary">
      <HeroSpinner size="sm" color="current" />
      {text}
    </div>
  )
}

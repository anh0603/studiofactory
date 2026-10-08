import { Kbd } from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  BookOpen,
  CalendarClock,
  ChartColumn,
  Clapperboard,
  Cpu,
  LayoutDashboard,
  ListVideo,
  Play,
  Plus,
  Route,
  Search,
  Send,
  Settings,
  ShoppingCart,
} from 'lucide-react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { CommandPalette } from '../components/palette'
import { Toasts } from '../components/toasts'
import { statusVi, t } from '../i18n/strings.vi'
import { useUi } from '../stores/ui'

type IconProps = { className?: string }

function IconGauge(p: IconProps) {
  return <LayoutDashboard className={p.className} aria-hidden="true" strokeWidth={1.8} />
}
function IconBook(p: IconProps) {
  return <BookOpen className={p.className} aria-hidden="true" strokeWidth={1.8} />
}
function IconCart(p: IconProps) {
  return <ShoppingCart className={p.className} aria-hidden="true" strokeWidth={1.8} />
}
function IconList(p: IconProps) {
  return <ListVideo className={p.className} aria-hidden="true" strokeWidth={1.8} />
}
function IconPlay(p: IconProps) {
  return <Play className={p.className} aria-hidden="true" strokeWidth={1.8} />
}
function IconClock(p: IconProps) {
  return <CalendarClock className={p.className} aria-hidden="true" strokeWidth={1.8} />
}
function IconUpload(p: IconProps) {
  return <Send className={p.className} aria-hidden="true" strokeWidth={1.8} />
}
function IconChip(p: IconProps) {
  return <Cpu className={p.className} aria-hidden="true" strokeWidth={1.8} />
}
function IconRoute(p: IconProps) {
  return <Route className={p.className} aria-hidden="true" strokeWidth={1.8} />
}
function IconChart(p: IconProps) {
  return <ChartColumn className={p.className} aria-hidden="true" strokeWidth={1.8} />
}
function IconPulse(p: IconProps) {
  return <Activity className={p.className} aria-hidden="true" strokeWidth={1.8} />
}
function IconGear(p: IconProps) {
  return <Settings className={p.className} aria-hidden="true" strokeWidth={1.8} />
}

type NavItem = { to: string; label: string; icon: (p: IconProps) => JSX.Element; end?: boolean }

const NAV: { group: string; items: NavItem[] }[] = [
  { group: t('nav.overview'), items: [
    { to: '/', label: t('nav.dashboard'), icon: IconGauge, end: true },
  ] },
  { group: t('nav.story'), items: [
    { to: '/story', label: t('nav.story.projects'), icon: IconBook },
  ] },
  { group: t('nav.affiliate'), items: [
    { to: '/affiliate', label: t('nav.affiliate.products'), icon: IconCart },
  ] },
  { group: t('nav.automation'), items: [
    { to: '/queue', label: t('nav.queue'), icon: IconList },
    { to: '/autopilot', label: t('nav.autopilot'), icon: IconPlay },
    { to: '/scheduler', label: t('nav.scheduler'), icon: IconClock },
    { to: '/publisher', label: t('nav.publisher'), icon: IconUpload },
  ] },
  { group: t('nav.ai'), items: [
    { to: '/ai/models', label: t('nav.ai.models'), icon: IconChip },
    { to: '/ai/router', label: t('nav.ai.router'), icon: IconRoute },
  ] },
  { group: t('nav.analytics'), items: [
    { to: '/analytics', label: t('nav.analytics.overview'), icon: IconChart },
  ] },
  { group: t('nav.system'), items: [
    { to: '/diagnostics', label: t('nav.diagnostics'), icon: IconPulse },
    { to: '/settings', label: t('nav.settings'), icon: IconGear },
  ] },
]

function Item({ to, label, icon: Icon, end, badge }: NavItem & { badge?: string | null }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] leading-5 ` +
        `transition-[background-color,color] duration-hover ease-out ` +
        (isActive
          ? 'bg-accent/10 font-semibold text-ink'
          : 'font-medium text-secondary hover:bg-raised hover:text-ink')
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden="true"
            className={
              'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent ' +
              'transition-opacity duration-hover ease-out ' +
              (isActive ? 'opacity-100' : 'opacity-0')
            }
          />
          <Icon
            className={
              'h-[18px] w-[18px] shrink-0 transition-colors duration-hover ease-out ' +
              (isActive ? 'text-accent' : 'text-muted group-hover:text-secondary')
            }
          />
          <span className="truncate">{label}</span>
          {badge ? (
            <span className="mono ml-auto shrink-0 rounded-full bg-raised px-2 py-0.5 text-[10.5px] font-medium text-secondary">
              {badge}
            </span>
          ) : null}
        </>
      )}
    </NavLink>
  )
}

/** Real backend liveness for the top bar. Silent on failure — never fake. */
function SystemPill() {
  const diag = useQuery({
    queryKey: ['diag-shell'],
    queryFn: api.diagnostics,
    staleTime: 30000,
    refetchInterval: 30000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
  const state = diag.data?.checks?.backend?.status
  const tone = state === 'HEALTHY' ? 'bg-emerald-400' : state ? 'bg-amber-400' : 'bg-muted'
  const pulse = state === 'HEALTHY' ? 'animate-dot-pulse' : ''
  return (
    <Link
      to="/diagnostics"
      title={t('nav.diagnostics')}
      className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-panel py-1 pl-2.5 pr-3 transition-colors duration-hover hover:border-ink/30"
    >
      <span className={`h-2 w-2 rounded-full ${tone} ${pulse}`} aria-hidden="true" />
      <span className="hidden text-[12px] font-semibold text-secondary lg:inline">
        {state === 'HEALTHY' ? statusVi.HEALTHY : '…'}
      </span>
    </Link>
  )
}

export function Shell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const setPalette = useUi((s) => s.setPalette)
  const jobsLive = useQuery({
    queryKey: ['jobs-shell'],
    queryFn: () => api.jobs(),
    staleTime: 30000,
    refetchInterval: 30000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
  const activeJobs = (jobsLive.data?.data ?? []).filter(
    (j) => j.status === 'RUNNING' || j.status === 'QUEUED').length
  const queueBadge = activeJobs > 0 ? String(activeJobs) : null
  const crumbs: Record<string, string> = {
    '/': t('nav.dashboard'),
    '/story': t('nav.story'),
    '/affiliate': t('nav.affiliate'),
    '/queue': t('nav.queue'),
    '/autopilot': t('nav.autopilot'),
    '/scheduler': t('nav.scheduler'),
    '/publisher': t('nav.publisher'),
    '/ai/models': t('nav.ai.models'),
    '/ai/router': t('nav.ai.router'),
    '/analytics': t('nav.analytics'),
    '/diagnostics': t('nav.diagnostics'),
    '/settings': t('nav.settings'),
  }
  const seg = '/' + (pathname.split('/')[1] || '')
  const here = pathname.startsWith('/story/') ? t('nav.story')
    : pathname.startsWith('/queue/') ? t('nav.queue')
    : pathname.startsWith('/ai/') ? (pathname.includes('router') ? t('nav.ai.router') : t('nav.ai.models'))
    : crumbs[pathname] ?? crumbs[seg] ?? ''

  return (
    <div className="flex min-h-screen bg-bg text-ink">
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-border bg-chrome md:flex" aria-label={t('nav.sidebar')}>
        <div className="flex items-center gap-3 px-4 pb-4 pt-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#8B7CF6] to-[#22D3EE] text-white shadow-[0_4px_16px_-4px_rgba(139,124,246,0.5)]">
            <Clapperboard className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[15px] font-extrabold tracking-tight text-ink">{t('app.title')}</p>
            <p className="truncate text-[11px] font-medium text-secondary">{t('app.subtitle')}</p>
          </div>
        </div>
        <button
          onClick={() => navigate('/story')}
          className="mx-3 mb-4 flex items-center gap-2.5 rounded-xl border border-border bg-raised px-3.5 py-2.5 text-[13.5px] font-medium transition-colors duration-hover hover:bg-elevated hover:text-ink"
        >
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md bg-gradient-to-br from-[#8B7CF6] to-[#22D3EE] text-white">
            <Plus className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
          </span>
          <span className="flex-1 text-left">{t('nav.new')}</span>
          <Kbd className="bg-panel font-mono text-[10px]">N</Kbd>
        </button>
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
          {NAV.map((g) => (
            <section key={g.group}>
              <p className="section-label mb-1.5">{g.group}</p>
              <div className="space-y-0.5">
                {g.items.map((it) => (
                  <Item key={it.to} {...it} badge={it.to === '/queue' ? queueBadge : null} />
                ))}
              </div>
            </section>
          ))}
        </nav>
        <div className="border-t border-border/70 p-3">
          <button
            onClick={() => setPalette(true)}
            className="flex w-full items-center gap-2 rounded-lg bg-raised px-3 py-2 text-left text-[11px] leading-relaxed text-secondary transition-colors duration-hover hover:bg-elevated hover:text-ink"
          >
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="flex-1 truncate">{t('nav.hint')}</span>
            <Kbd className="bg-elevated font-mono text-[10px]">K</Kbd>
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-border bg-chrome/90 px-4 py-3 backdrop-blur-md md:px-6">
          <div className="flex items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-1.5 text-[13px]">
              <span className="truncate font-medium text-secondary">{t('app.title')}</span>
              {here ? (
                <>
                  <span className="text-muted">/</span>
                  <span className="truncate font-semibold text-ink">{here}</span>
                </>
              ) : null}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => setPalette(true)}
                aria-label="Ctrl K"
                className="flex items-center gap-1.5 rounded-full border border-border bg-panel px-2.5 py-1 text-secondary transition-colors duration-hover hover:border-ink/30 hover:text-ink md:hidden"
              >
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <SystemPill />
              <p className="hidden shrink-0 items-center gap-1 text-[11px] font-medium text-secondary sm:flex">
                <Kbd className="bg-raised font-mono text-[10px]">Ctrl</Kbd>
                <Kbd className="bg-raised font-mono text-[10px]">K</Kbd>
              </p>
            </div>
          </div>
          <nav className="-mb-1 mt-2 flex gap-1 overflow-x-auto md:hidden" aria-label={t('nav.sidebar')}>
            {NAV.flatMap((g) => g.items).map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.end}
                className={({ isActive }) =>
                  `shrink-0 rounded-full px-3 py-1 text-[13px] font-medium ` +
                  `transition-colors duration-hover ease-out ` +
                  (isActive ? 'bg-elevated font-semibold text-ink' : 'text-secondary hover:bg-raised hover:text-ink')
                }
              >
                {it.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="min-w-0 flex-1 px-4 py-5 md:px-6 md:py-6">
          <div className="page animate-fade-rise" key={pathname}>
            <Outlet />
          </div>
        </main>
      </div>
      <Toasts />
      <CommandPalette />
    </div>
  )
}

import {
  Activity,
  BookOpen,
  CalendarClock,
  ChartColumn,
  Cpu,
  LayoutDashboard,
  ListVideo,
  Play,
  Route,
  Send,
  Settings,
  ShoppingCart,
} from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { CommandPalette } from '../components/palette'
import { Toasts } from '../components/toasts'
import { t } from '../i18n/strings.vi'

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

function Item({ to, label, icon: Icon, end }: NavItem) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] leading-5 ` +
        `transition-[background-color,color] duration-hover ease-out ` +
        (isActive
          ? 'bg-[#242C36] font-semibold text-white'
          : 'font-medium text-secondary hover:bg-[#1A2028] hover:text-ink')
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden="true"
            className={
              'absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r bg-accent ' +
              'transition-opacity duration-hover ease-out ' +
              (isActive ? 'opacity-100' : 'opacity-0')
            }
          />
          <Icon
            className={
              'h-[18px] w-[18px] shrink-0 transition-colors duration-hover ease-out ' +
              (isActive ? 'text-accent' : 'text-[#7D8A9C] group-hover:text-secondary')
            }
          />
          <span className="truncate">{label}</span>
        </>
      )}
    </NavLink>
  )
}

export function Shell() {
  const { pathname } = useLocation()
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
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-surface md:flex" aria-label={t('nav.sidebar')}>
        <div className="flex items-center gap-3 border-b border-border px-4 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-base font-black text-[#1A0E07]">S</span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[15px] font-bold text-ink">{t('app.title')}</p>
            <p className="truncate text-[11px] font-medium text-secondary">{t('app.subtitle')}</p>
          </div>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
          {NAV.map((g) => (
            <section key={g.group}>
              <p className="section-label mb-1.5">{g.group}</p>
              <div className="space-y-0.5">
                {g.items.map((it) => <Item key={it.to} {...it} />)}
              </div>
            </section>
          ))}
        </nav>
        <div className="border-t border-border p-3">
          <p className="rounded-lg bg-[#1A2028] px-3 py-2 text-[11px] leading-relaxed text-secondary">
            {t('nav.hint')} <kbd className="rounded border border-border bg-[#242C36] px-1 font-mono text-[10px] font-semibold text-ink">Ctrl K</kbd> {t('nav.hint.kbd')}
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur md:px-6">
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
            <p className="hidden shrink-0 items-center gap-1.5 text-[11px] font-medium text-secondary sm:flex">
              <kbd className="rounded border border-border bg-[#1A2028] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink">Ctrl</kbd>
              <kbd className="rounded border border-border bg-[#1A2028] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink">K</kbd>
            </p>
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
                  (isActive ? 'bg-[#242C36] font-semibold text-white' : 'text-secondary hover:bg-[#1A2028] hover:text-ink')
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
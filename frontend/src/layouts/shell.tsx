import { NavLink, Outlet } from 'react-router-dom'
import { CommandPalette } from '../components/palette'
import { Toasts } from '../components/toasts'
import { t } from '../i18n/strings.vi'

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `block rounded px-3 py-2 text-sm ${isActive ? 'bg-surface text-ink' : 'text-secondary hover:text-ink'}`

export function Shell() {
  return (
    <div className="flex min-h-screen bg-bg text-ink">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface/40 p-4 md:block" aria-label="Sidebar">
        <p className="px-1 text-sm font-bold tracking-wide">{t('app.title')}</p>
        <nav className="mt-4 space-y-4 text-sm">
          <section>
            <p className="px-3 text-xs uppercase text-muted">{t('nav.overview')}</p>
            <NavLink to="/" className={linkCls}>{t('nav.dashboard')}</NavLink>
          </section>
          <section>
            <p className="px-3 text-xs uppercase text-muted">{t('nav.story')}</p>
            <NavLink to="/story" className={linkCls}>Story</NavLink>
          </section>
          <section>
            <p className="px-3 text-xs uppercase text-muted">{t('nav.affiliate')}</p>
            <NavLink to="/affiliate" className={linkCls}>Affiliate</NavLink>
          </section>
          <section>
            <p className="px-3 text-xs uppercase text-muted">{t('nav.automation')}</p>
            <NavLink to="/queue" className={linkCls}>Queue</NavLink>
            <NavLink to="/autopilot" className={linkCls}>Auto Pilot</NavLink>
            <NavLink to="/scheduler" className={linkCls}>Scheduler</NavLink>
            <NavLink to="/publisher" className={linkCls}>Publisher</NavLink>
          </section>
          <section>
            <p className="px-3 text-xs uppercase text-muted">{t('nav.ai')}</p>
            <NavLink to="/ai/models" className={linkCls}>Models</NavLink>
            <NavLink to="/ai/router" className={linkCls}>Router</NavLink>
          </section>
          <section>
            <p className="px-3 text-xs uppercase text-muted">Analytics</p>
            <NavLink to="/analytics" className={linkCls}>Tổng quan</NavLink>
          </section>
          <section>
            <p className="px-3 text-xs uppercase text-muted">{t('nav.system')}</p>
            <NavLink to="/diagnostics" className={linkCls}>Diagnostics</NavLink>
            <NavLink to="/settings" className={linkCls}>Settings</NavLink>
          </section>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm text-secondary">AI Video Automation Factory</p>
          <p className="text-xs text-muted">Ctrl+K</p>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
      <Toasts />
      <CommandPalette />
    </div>
  )
}

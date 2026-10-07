import { Tab, Tabs } from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Clapperboard } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { EmptyState, ErrorState, LoadingList } from '../components/states'
import { PageHeader, StatusBadge } from '../components/ui'
import { labelVi } from '../i18n/strings.vi'

const FILTERS = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'QUEUED', label: 'Chờ xử lý' },
  { key: 'RUNNING', label: 'Đang chạy' },
  { key: 'PAUSED', label: 'Tạm dừng' },
  { key: 'SUCCEEDED', label: 'Thành công' },
  { key: 'FAILED', label: 'Thất bại' },
  { key: 'CANCELLED', label: 'Đã huỷ' },
] as const

export function QueuePage() {
  const [filter, setFilter] = useState<string>('ALL')
  const jobs = useQuery({
    queryKey: ['jobs', filter],
    queryFn: () => api.jobs(filter === 'ALL' ? undefined : filter),
    refetchInterval: 3000,
  })

  if (jobs.isPending) return <LoadingList rows={5} />
  if (jobs.isError)
    return <ErrorState message={(jobs.error as Error).message} onRetry={() => jobs.refetch()} />

  return (
    <div className="space-y-4">
      <PageHeader title="Hàng đợi sản xuất" sub={`${jobs.data.data.length} tác vụ · tự cập nhật mỗi 3 giây`} />
      <Tabs
        selectedKey={filter}
        onSelectionChange={(k) => setFilter(k as string)}
        variant="bordered"
        size="sm"
        aria-label="Lọc tác vụ"
        classNames={{ tabList: 'border-border bg-surface' }}
      >
        {FILTERS.map((f) => (
          <Tab key={f.key} title={f.label} />
        ))}
      </Tabs>
      {jobs.data.data.length === 0 ? (
        <EmptyState
          icon="◌"
          title="Hàng đợi trống. Tác vụ được tạo từ một dự án có Director Plan đã duyệt."
          action={<Link to="/story" className="btn btn-accent">Mở Story Factory</Link>}
        />
      ) : (
        <ul className="space-y-2">
          {jobs.data.data.map((j) => (
            <li key={j.id}>
              <Link to={`/queue/${j.id}`} className="row-item row-item-hover group flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-panel text-secondary transition-colors duration-hover group-hover:border-ink/30 group-hover:text-accent" aria-hidden="true">
                  <Clapperboard className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="mono truncate">{j.id}</p>
                  <p className="mt-0.5 truncate text-xs text-secondary">{labelVi(j.stage)}{j.status_text ? ` · ${j.status_text}` : ''}</p>
                </div>
                <StatusBadge value={j.status} className="shrink-0" />
                <ChevronRight className="h-4 w-4 shrink-0 text-muted transition-transform duration-hover group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

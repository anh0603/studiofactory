import { useQuery } from '@tanstack/react-query'
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
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={
              `rounded-full border px-3 py-1 text-xs font-semibold ` +
              `transition-[background-color,border-color,color] duration-hover ease-out ` +
              (filter === f.key
                ? 'border-[#7A4520] bg-[#2B1A10] text-[#F7A672]'
                : 'border-border bg-surface text-secondary hover:border-[#3A4350] hover:text-ink')
            }
          >
            {f.label}
          </button>
        ))}
      </div>
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
              <Link to={`/queue/${j.id}`} className="row-item row-item-hover flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="mono truncate">{j.id}</p>
                  <p className="mt-0.5 truncate text-xs text-secondary">{labelVi(j.stage)}{j.status_text ? ` · ${j.status_text}` : ''}</p>
                </div>
                <StatusBadge value={j.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
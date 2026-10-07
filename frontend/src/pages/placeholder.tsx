import { EmptyState } from '../components/states'
import { PageHeader } from '../components/ui'

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <PageHeader title={title} sub="Phần này sẽ được xây dựng ở giai đoạn sau." />
      <EmptyState title="Chưa có dữ liệu. Phần này sẽ được bổ sung ở giai đoạn sau." />
    </div>
  )
}
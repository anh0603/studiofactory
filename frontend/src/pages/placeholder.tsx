import { EmptyState } from '../components/states'

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{title}</h1>
      <EmptyState title="Chưa có dữ liệu. Module này triển khai ở phase sau." />
    </div>
  )
}

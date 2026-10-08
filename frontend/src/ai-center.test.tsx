import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AiModelsPage } from './pages/ai-models'

function mockFetch() {
  global.fetch = vi.fn(async (url: unknown) => ({
    ok: true,
    headers: { get: () => 'req_test' },
    json: async () => {
      const u = String(url)
      if (u.includes('/providers')) return { request_id: 'req_test', data: [] }
      if (u.includes('/models')) return { request_id: 'req_test', data: [] }
      return { request_id: 'req_test', data: [] }
    },
  })) as unknown as typeof fetch
}

describe('ai model center', () => {
  it('renders real empty states without mock data', async () => {
    mockFetch()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <AiModelsPage />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('Mô hình AI')).toBeTruthy())
    expect(screen.getByText(/Chưa có nhà cung cấp/)).toBeTruthy()
  })
})
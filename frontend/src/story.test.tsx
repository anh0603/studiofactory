import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StoryProjectsPage } from './pages/story'

describe('story projects', () => {
  it('renders real empty state without mock plans', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'req_test' },
      json: async () => ({ request_id: 'req_test', data: [] }),
    })) as unknown as typeof fetch
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <StoryProjectsPage />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('Story Factory')).toBeTruthy())
    expect(screen.getByText(/Chưa có project/)).toBeTruthy()
  })
})

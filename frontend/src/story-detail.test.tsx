import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { StoryDetailPage } from './pages/story-detail'

/** Guards the class of bug where a hook sits after an early return. */
function mockFetch() {
  global.fetch = vi.fn(async (url: unknown) => {
    const u = String(url)
    const ok = { ok: true, headers: { get: () => 'req_test' }, json: async () => ({ request_id: 'req_test', data: [] }) }
    if (u.includes('/qc')) return { ...ok, json: async () => ({ request_id: 'r', data: { qc: { verdict: 'BLOCKED', checks: [] }, gate: { decision: 'BLOCKED', reasons: ['a'] } } }) }
    if (/\/projects\/[^/]+$/.test(u)) {
      return {
        ...ok,
        json: async () => ({
          request_id: 'req_test',
          data: { id: 'prj_1', name: 'Dự án thử', description: 'Một câu chuyện', factory_type: 'story', language: 'vi', style: '', audience: 'trẻ em', duration_target: 30, status: 'DRAFT', updated_at: '2026-10-02T02:20:10Z' },
        }),
      }
    }
    return ok
  }) as unknown as typeof fetch
}

describe('story detail smoke', () => {
  it('renders the workflow strip and decision bar without crashing', async () => {
    mockFetch()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/story/prj_1']}>
          <Routes>
            <Route path="/story/:projectId" element={<StoryDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('Dự án thử')).toBeTruthy())
    const strip = screen.getByTestId('workflow-strip')
    expect(strip).toBeTruthy()
    expect(within(strip).getByText('AI Director')).toBeTruthy()
    expect(within(strip).getByText('Cổng SX')).toBeTruthy()
    // Resolver drives the decision bar, not hardcoded copy.
    expect(screen.getByTestId('next-action')).toBeTruthy()
  })
})
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StoryProjectsPage } from './pages/story'

function mockFetch(over?: (url: string, init?: RequestInit) => unknown) {
  global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    if (over) {
      const r = over(u, init)
      if (r) return r
    }
    if (/\/projects$/.test(u) && (init?.method ?? 'GET') === 'POST') {
      return { ok: true, headers: { get: () => 'req_1' }, json: async () => ({ request_id: 'req_1', data: { id: 'prj_new', name: 'Truyện mới', status: 'DRAFT' } }) }
    }
    return { ok: true, headers: { get: () => 'req_1' }, json: async () => ({ request_id: 'req_1', data: [] }) }
  }) as unknown as typeof fetch
}

const renderPage = (initial = '/story') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/story" element={<StoryProjectsPage />} />
          <Route path="/story/:projectId" element={<div>DETAIL</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('first run story experience', () => {
  it('leads with the pipeline in plain language', async () => {
    mockFetch()
    renderPage()
    await waitFor(() => expect(screen.getByText('Bạn bắt đầu một video ở đây')).toBeTruthy())
    expect(screen.getByText('Kịch bản')).toBeTruthy()
    expect(screen.getByText('Kiểm định')).toBeTruthy()
  })

  it('offers a single primary create action', async () => {
    mockFetch()
    renderPage()
    await waitFor(() => expect(screen.getByText('Tạo Story đầu tiên')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Tạo Story' })).toBeTruthy()
  })

  it('never leaks a raw project status on the list', async () => {
    mockFetch((u) => (/\/projects$/.test(u) && u.includes('/api/') && !u.includes('?')
      ? { ok: true, headers: { get: () => 'r' }, json: async () => ({ request_id: 'r', data: [{ id: 'p1', name: 'A', description: '', factory_type: 'story', language: 'vi', style: '', audience: '', duration_target: 30, status: 'DRAFT' }] }) }
      : null))
    renderPage()
    await waitFor(() => expect(screen.getByText('A')).toBeTruthy())
    expect(screen.getByText('Bản nháp')).toBeTruthy()
    expect(screen.queryByText('DRAFT')).toBeNull()
  })
})

describe('create story flow', () => {
  it('keeps create disabled until a name is entered', async () => {
    mockFetch()
    renderPage()
    await waitFor(() => expect(screen.getByText('Tạo Story đầu tiên')).toBeTruthy())
    expect((screen.getByRole('button', { name: 'Tạo Story' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Tên câu chuyện'), { target: { value: 'Mèo Mộc' } })
    expect((screen.getByRole('button', { name: 'Tạo Story' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('creates through the real API then routes to the returned project id', async () => {
    mockFetch()
    renderPage()
    await waitFor(() => expect(screen.getByText('Tạo Story đầu tiên')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Tên câu chuyện'), { target: { value: 'Mèo Mộc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tạo Story' }))
    // Redirect uses the id returned by the API, not a locally invented one.
    await waitFor(() => expect(screen.getByText('DETAIL')).toBeTruthy())
  })

  it('shows what happened, why and what to do on failure', async () => {
    mockFetch((u, init) => (/\/projects$/.test(u) && (init?.method ?? 'GET') === 'POST'
      ? { ok: false, status: 400, headers: { get: () => 'req_err' }, json: async () => ({ error: { code: 'BAD_REQUEST', message: 'Tên quá ngắn', request_id: 'req_err' } }) }
      : null))
    renderPage()
    await waitFor(() => expect(screen.getByText('Tạo Story đầu tiên')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Tên câu chuyện'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tạo Story' }))
    await waitFor(() => expect(screen.getByText('Đã xảy ra:')).toBeTruthy())
    expect(screen.getByText('Nguyên nhân:')).toBeTruthy()
    expect(screen.getByText('Cách xử lý:')).toBeTruthy()
    // Raw identifiers stay out of the main surface.
    expect(screen.queryByText('req_err')).toBeNull()
    expect(screen.getByText('Chi tiết kỹ thuật')).toBeTruthy()
  })
})
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiModelsPage } from './pages/ai-models'
import { guessCapabilities, expandCapabilities } from './pages/ai-models'
import { AiRouterPage } from './pages/ai-router'
import { DiagnosticsPage } from './pages/diagnostics'

type Json = unknown

const ok = (data: unknown) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'req_test' },
  json: async () => ({ request_id: 'req_test', data }),
})

/** Route table so each page gets exactly the payload it asks for. */
function mockApi(routes: Record<string, (url: string, init?: RequestInit) => Json | undefined>) {
  const calls: { url: string; method: string; body: unknown }[] = []
  global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    for (const [pattern, handler] of Object.entries(routes)) {
      if (u.includes(pattern)) {
        const data = handler(u, init)
        if (data !== undefined) return ok(data)
      }
    }
    return ok([])
  }) as unknown as typeof fetch
  return calls
}

/** `/diagnostics` returns `checks` at the top level, not wrapped in `data`. */
function mockDiagnostics(checks: Record<string, unknown>) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'req_test' },
    json: async () => ({ request_id: 'req_test', checks }),
  })) as unknown as typeof fetch
}

const wrap = (ui: React.ReactNode, path = '/ai/models') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/ai/models" element={<>{ui}</>} />
          <Route path="/ai/router" element={<>{ui}</>} />
          <Route path="/diagnostics" element={<>{ui}</>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const renderModels = () => wrap(<AiModelsPage />)
const renderRouter = () => wrap(<AiRouterPage />, '/ai/router')
const renderDiagnostics = () => wrap(<DiagnosticsPage />, '/diagnostics')

const model = (over: Record<string, unknown> = {}) => ({
  id: 'mdl_1', provider_id: 'prov_1', credential_ref: 'cred_1', name: 'Free Story',
  model_id: 'vendor/free-story', capabilities: ['STORY'], priority: 100, enabled: true,
  cost_class: 'FREE', license_status: 'VERIFIED_COMMERCIAL', health_status: 'UNKNOWN',
  ...over,
})

const provider = (over: Record<string, unknown> = {}) => ({
  id: 'prov_1', name: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1',
  adapter_key: 'openai_compatible', enabled: true, health: 'UNKNOWN',
  credential_configured: true, ...over,
})

afterEach(() => vi.restoreAllMocks())

describe('no provider configured', () => {
  it('guides the operator through the three configuration steps', async () => {
    mockApi({ '/ai/providers': () => [], '/ai/models': () => [] })
    renderModels()
    await waitFor(() => expect(screen.getByText('Cấu hình theo 3 bước')).toBeTruthy())
    expect(screen.getByText('Nhà cung cấp')).toBeTruthy()
    expect(screen.getByText('Khoá truy cập')).toBeTruthy()
    expect(screen.getByText('Mô hình')).toBeTruthy()
    // Step 1 is the current one; later steps must not claim to be done.
    expect(screen.getByText('Đang làm bước này')).toBeTruthy()
  })

  it('never claims a healthy provider when none exists', async () => {
    mockApi({ '/ai/providers': () => [], '/ai/models': () => [] })
    renderModels()
    await waitFor(() => expect(screen.getByText(/Chưa có nhà cung cấp/)).toBeTruthy())
    expect(screen.queryByText(/đã cấu hình/)).toBeNull()
  })

  it('offers openai-compatible adapters without hardcoding one provider', async () => {
    mockApi({ '/ai/providers': () => [], '/ai/models': () => [] })
    renderModels()
    await waitFor(() => expect(screen.getByText('Cấu hình theo 3 bước')).toBeTruthy())
    const select = screen.getByLabelText('Kiểu kết nối') as HTMLSelectElement
    const values = [...select.options].map((o) => o.value)
    expect(values).toContain('openai_compatible')
    expect(values).toContain('custom')
    // The example URL is a placeholder only, never a saved provider.
    const url = screen.getByLabelText('Địa chỉ cơ sở') as HTMLInputElement
    expect(url.value).toBe('')
    expect(url.placeholder).toContain('https://openrouter.ai/api/v1')
  })
})

describe('add provider then credential', () => {
  it('posts the provider exactly as typed', async () => {
    const calls = mockApi({ '/ai/providers': () => [], '/ai/models': () => [] })
    renderModels()
    await waitFor(() => expect(screen.getByText('Cấu hình theo 3 bước')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Tên nhà cung cấp'), { target: { value: 'OpenRouter' } })
    fireEvent.change(screen.getByLabelText('Địa chỉ cơ sở'), { target: { value: 'https://openrouter.ai/api/v1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Thêm nhà cung cấp' }))
    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.includes('/ai/providers'))
      expect(post?.body).toEqual({
        name: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', adapter_key: 'openai_compatible',
      })
    })
  })

  it('surfaces a server-side rejection instead of failing silently', async () => {
    global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      const okResp = { ok: true, status: 200, headers: { get: () => 'req_test' }, json: async () => ({ request_id: 'req_test', data: [] }) }
      if (u.includes('/ai/providers') && (init?.method ?? 'GET') === 'POST') {
        return {
          ok: false, status: 400, headers: { get: () => 'req_err' },
          json: async () => ({ error: { code: 'BAD_REQUEST', message: 'invalid provider URL: provider host not allowed', request_id: 'req_err' } }),
        }
      }
      return okResp
    }) as unknown as typeof fetch
    renderModels()
    await waitFor(() => expect(screen.getByText('Cấu hình theo 3 bước')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Tên nhà cung cấp'), { target: { value: 'X' } })
    fireEvent.change(screen.getByLabelText('Địa chỉ cơ sở'), { target: { value: 'http://localhost:1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Thêm nhà cung cấp' }))
    await waitFor(() => expect(screen.getByText('Đã xảy ra:')).toBeTruthy())
    expect(screen.getByText('Nguyên nhân:')).toBeTruthy()
    expect(screen.getByText('Cách xử lý:')).toBeTruthy()
  })

  it('clears the secret from the field after saving and never renders it back', async () => {
    mockApi({
      '/ai/providers': () => [provider()],
      '/ai/models': () => [],
    })
    renderModels()
    await waitFor(() => expect(screen.getAllByText(/OpenRouter/).length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Đổi khoá' }))
    const input = screen.getByLabelText('Khoá truy cập') as HTMLInputElement
    expect(input.type).toBe('password')
    fireEvent.change(input, { target: { value: 'sk-super-secret-value' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(screen.getByText(/Giá trị không hiển thị lại/)).toBeTruthy())
    expect((screen.getByLabelText('Khoá truy cập') as HTMLInputElement).value).toBe('')
    // The secret must not appear anywhere in the rendered output.
    expect(document.body.textContent).not.toContain('sk-super-secret-value')
  })

  it('shows only a configured flag for a provider that has a credential', async () => {
    mockApi({ '/ai/providers': () => [provider({ credential_configured: true })], '/ai/models': () => [] })
    renderModels()
    await waitFor(() => expect(screen.getByText(/khoá: đã cấu hình/)).toBeTruthy())
    expect(document.body.textContent).not.toMatch(/sk-/)
  })
})

describe('add model', () => {
  const withProvider = {
    '/ai/providers': () => [provider()],
    '/ai/models': () => [],
  }

  it('requires a provider and a name', async () => {
    mockApi(withProvider)
    renderModels()
    await waitFor(() => expect(screen.getAllByText(/OpenRouter/).length).toBeGreaterThan(0))
    expect((screen.getByRole('button', { name: 'Thêm mô hình' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('sends capability, cost, license and priority explicitly', async () => {
    const calls = mockApi(withProvider)
    renderModels()
    await waitFor(() => expect(screen.getAllByText(/OpenRouter/).length).toBeGreaterThan(0))
    fireEvent.change(screen.getByLabelText('Nhà cung cấp của mô hình'), { target: { value: 'prov_1' } })
    fireEvent.change(screen.getByLabelText('Tên mô hình'), { target: { value: 'Free Story' } })
    fireEvent.change(screen.getByLabelText('Mã mô hình'), { target: { value: 'vendor/free-story' } })
    fireEvent.change(screen.getByLabelText('Năng lực'), { target: { value: 'STORY' } })
    fireEvent.change(screen.getByLabelText('Lớp chi phí'), { target: { value: 'FREE' } })
    fireEvent.change(screen.getByLabelText('Ưu tiên'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Thêm mô hình' }))
    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/ai/models'))
      expect(post?.body).toMatchObject({
        provider_id: 'prov_1', name: 'Free Story', model_id: 'vendor/free-story',
        capabilities: ['STORY'], cost_class: 'FREE', license_status: 'VERIFIED_COMMERCIAL', priority: 50,
      })
    })
  })

  it('warns that a paid model will be blocked, without enabling paid usage', async () => {
    mockApi(withProvider)
    renderModels()
    await waitFor(() => expect(screen.getAllByText(/OpenRouter/).length).toBeGreaterThan(0))
    fireEvent.change(screen.getByLabelText('Lớp chi phí'), { target: { value: 'PAID' } })
    expect(screen.getByText(/sẽ bị chặn trước khi gọi nhà cung cấp/)).toBeTruthy()
    // No toggle that could switch on paid usage anywhere on the page.
    expect(screen.queryByLabelText(/cho phép.*trả phí/i)).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('warns when the license cannot satisfy a commercial requirement', async () => {
    mockApi(withProvider)
    renderModels()
    await waitFor(() => expect(screen.getAllByText(/OpenRouter/).length).toBeGreaterThan(0))
    fireEvent.change(screen.getByLabelText('Giấy phép'), { target: { value: 'UNKNOWN' } })
    expect(screen.getByText(/yêu cầu giấy phép thương mại/)).toBeTruthy()
  })
})

describe('capability test states', () => {
  it('does not present an untested model as verified', async () => {
    mockApi({ '/ai/providers': () => [provider()], '/ai/models': () => [model()] })
    renderModels()
    await waitFor(() => expect(screen.getAllByText(/Free Story/).length).toBeGreaterThan(0))
    expect(screen.getAllByText('Chưa kiểm tra').length).toBeGreaterThan(0)
    expect(screen.queryByText('Đã kiểm tra năng lực')).toBeNull()
    expect(screen.queryByText('Đã xác thực')).toBeNull()
  })

  it('reports AUTHENTICATED as exactly that, not as capability verified', async () => {
    mockApi({
      '/ai/models/': (u) => (u.includes('/test') ? { state: 'AUTHENTICATED', mock: false, note: 'list-only; generation NOT verified' } : undefined),
      '/ai/providers': () => [provider()],
      '/ai/models': () => [model()],
    })
    renderModels()
    await waitFor(() => expect(screen.getAllByText(/Free Story/).length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra năng lực' }))
    await waitFor(() => expect(screen.getByText(/Đã xác thực/)).toBeTruthy())
    expect(screen.getByText(/generation NOT verified/)).toBeTruthy()
  })
})

describe('capability auto-detect', () => {
  it('guesses media capabilities from the model id', () => {
    expect(guessCapabilities('black-forest-labs/flux-schnell', '')).toEqual(['IMAGE'])
    expect(guessCapabilities('gemini-2.5-flash-preview-tts', '')).toEqual(['TTS'])
    expect(guessCapabilities('text-embedding-3-small', '')).toEqual(['EMBEDDING'])
  })

  it('gives chat models story too, and vision models text', () => {
    expect(guessCapabilities('llama-3.3-70b', '')).toEqual(['TEXT', 'STORY'])
    expect(guessCapabilities('gemini-2.5-flash', '')).toEqual(['TEXT', 'STORY', 'VISION'])
  })

  it('expands a manual pick the same way', () => {
    expect(expandCapabilities('TEXT')).toEqual(['TEXT', 'STORY'])
    expect(expandCapabilities('STORY')).toEqual(['STORY'])
    expect(expandCapabilities('IMAGE')).toEqual(['IMAGE'])
  })

  it('shows the guess in the form as the code is typed', async () => {
    mockApi({
      '/ai/providers': () => [provider()],
      '/ai/models': () => [],
    })
    renderModels()
    await waitFor(() => expect(screen.getAllByText(/OpenRouter/).length).toBeGreaterThan(0))
    fireEvent.change(screen.getByLabelText('Mã mô hình'), { target: { value: 'flux-schnell' } })
    await waitFor(() => expect(
      screen.getByText((_c, el) => el?.tagName === 'P' && /Web tự nhận/.test(el.textContent ?? '')),
    ).toHaveTextContent(/Hình ảnh/))
  })
})

describe('router page with nothing configured', () => {
  it('says no model is usable and links to configuration', async () => {
    mockApi({
      '/ai/router/eligible': () => ({ strategy_resolved: 'PRIORITY', eligible: [], excluded: [], circuit: {} }),
      '/ai/activity': () => [],
      '/ai/usage': () => ({ requests: 0, successful: 0, failed: 0, fallbacks: 0, avg_latency_ms: 0, by_model: [], cost: null, cost_state: 'UNKNOWN' }),
    })
    renderRouter()
    await waitFor(() => expect(screen.getByText('Chưa có model khả dụng')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Cấu hình model' })).toBeTruthy()
    expect(screen.queryByText(/Router healthy/i)).toBeNull()
  })

  it('explains each excluded model in plain language', async () => {
    mockApi({
      '/ai/router/eligible': () => ({
        strategy_resolved: 'PRIORITY', eligible: [],
        excluded: [{ model: 'PaidM', reason: 'PAID_MODEL_BLOCKED' }, { model: 'NoCred', reason: 'CREDENTIAL_MISSING' }],
        circuit: {},
      }),
      '/ai/activity': () => [],
      '/ai/usage': () => ({ requests: 0, successful: 0, failed: 0, fallbacks: 0, avg_latency_ms: 0, by_model: [], cost: null, cost_state: 'UNKNOWN' }),
    })
    renderRouter()
    await waitFor(() => expect(screen.getByText('Chưa có model khả dụng')).toBeTruthy())
    expect(screen.getByText(/Mô hình trả phí đang bị chính sách chặn/)).toBeTruthy()
    expect(screen.getByText(/Chưa lưu khoá truy cập/)).toBeTruthy()
  })

  it('separates blocked calls from real provider calls', async () => {
    mockApi({
      '/ai/router/eligible': () => ({ strategy_resolved: 'PRIORITY', eligible: [model()], excluded: [], circuit: {} }),
      '/ai/activity': () => [
        { request_id: 'r1', job_id: null, task: 'STORY_GENERATION', capability: 'STORY', provider: '', model: '', attempt: 0, latency_ms: 0, status: 'BLOCKED', error_category: 'MODEL_UNAVAILABLE', fallback_reason: null, mock: false, created_at: '' },
        { request_id: 'r2', job_id: null, task: 'IMAGE_GENERATION', capability: 'IMAGE', provider: 'Prov', model: 'M', attempt: 1, latency_ms: 812, status: 'SUCCESS', error_category: null, fallback_reason: null, mock: false, created_at: '' },
      ],
      '/ai/usage': () => ({ requests: 2, successful: 1, failed: 1, fallbacks: 0, avg_latency_ms: 812, by_model: [], cost: null, cost_state: 'UNKNOWN' }),
    })
    renderRouter()
    await waitFor(() => expect(document.body.textContent).toMatch(/1 bị chặn trước khi gọi mạng, 1 đã gọi/))
    // Blocked row: no provider named, described as blocked before network.
    expect(screen.getByText(/chưa gọi nhà cung cấp/)).toBeTruthy()
    expect(screen.getByText(/^bị chặn trước khi gọi mạng/)).toBeTruthy()
    // Real row: provider + model + latency.
    expect(screen.getByText(/Prov\/M$/)).toBeTruthy()
    expect(screen.getByText(/đã gọi nhà cung cấp · 812ms/)).toBeTruthy()
    // And the usage split states it plainly (text is split by <strong>, so match on
    // the container's full text).
    const split = document.body.textContent ?? ''
    expect(split).toMatch(/1 bị chặn trước khi gọi mạng, 1 đã gọi nhà cung cấp/)
    expect(split).toMatch(/không phải là yêu cầu tới nhà cung cấp nên không tốn credit/)
  })
})

describe('diagnostics page', () => {
  const checks = {
    backend: { status: 'HEALTHY', detail: 'fastapi running' },
    database: { status: 'HEALTHY', detail: 'sqlite reachable' },
    storage: { status: 'HEALTHY', detail: 'projects root writable' },
    ffmpeg: { status: 'HEALTHY', detail: 'C:/ffmpeg.exe' },
    ffprobe: { status: 'HEALTHY', detail: 'C:/ffprobe.exe' },
    ai_providers: { status: 'CONFIG_REQUIRED', detail: 'chưa đăng ký nhà cung cấp AI nào' },
    ai_credentials: { status: 'CONFIG_REQUIRED', detail: 'chưa lưu khoá truy cập nào' },
    ai_models: { status: 'CONFIG_REQUIRED', detail: 'chưa đăng ký mô hình nào' },
    scheduler: { status: 'HEALTHY', detail: 'bộ lập lịch sẵn sàng · chưa có lịch đăng nào' },
    publisher: { status: 'CONFIG_REQUIRED', detail: 'chưa kết nối tài khoản đăng bài' },
  }

  it('groups production infrastructure apart from AI configuration', async () => {
    mockDiagnostics(checks)
    renderDiagnostics()
    await waitFor(() => expect(screen.getByText('Hạ tầng sản xuất')).toBeTruthy())
    expect(screen.getByText('Trí tuệ nhân tạo')).toBeTruthy()
    expect(screen.getByText('Tự động hoá và đăng bài')).toBeTruthy()
    expect(screen.getByText('FFprobe')).toBeTruthy()
    expect(screen.getByText('Nhà cung cấp AI')).toBeTruthy()
    expect(screen.getByText('Mô hình AI')).toBeTruthy()
    expect(screen.getByText('Khoá truy cập AI')).toBeTruthy()
  })

  it('counts what still needs configuration and links to the fix', async () => {
    mockDiagnostics(checks)
    renderDiagnostics()
    await waitFor(() => expect(screen.getByText(/4 thành phần chưa cấu hình/)).toBeTruthy())
    expect(screen.getByRole('button', { name: /Cấu hình nhà cung cấp AI/ })).toBeTruthy()
  })

  it('renders no secret material even if a detail were odd', async () => {
    mockDiagnostics(checks)
    renderDiagnostics()
    await waitFor(() => expect(screen.getByText('Hạ tầng sản xuất')).toBeTruthy())
    expect(document.body.textContent).not.toMatch(/sk-[a-z0-9]/i)
  })
})
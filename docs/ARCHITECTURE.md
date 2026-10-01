# ARCHITECTURE — AI Short Factory Web Pro (Phase 0)

> Source of truth: `project.md` + `design.md` ở root.
> File này KHÔNG viết lại spec. Nó chỉ chốt boundaries + contracts để implement.
> Stack freeze: React + TypeScript + Vite + Tailwind | FastAPI + SQLAlchemy + Alembic + SQLite | FFmpeg | Cloud AI BYOK.
> Cấm: Tauri / Electron / Rust / C# / WinUI / local LLM / Ollama.
> Mặc định UI tiếng Việt. Không thêm i18n dependency ở Phase 0/1, chỉ dùng text abstraction (xem §10).
> Phase 0: KHÔNG code Phase 1, KHÔNG cài dependency, KHÔNG tạo UI, KHÔNG tạo migration.

---

## 1. System topology (local-first)

```text
Browser (React+Vite)
  ↓ HTTP /api/v1/* + WebSocket /ws
FastAPI (application backend, domain-owned)
  ├── AI Core: Provider Registry → Adapter → Router → Activity/Usage
  ├── Creative: Projects / Director / Characters / Scenes / Affiliate
  ├── Production: Workflow Engine / Queue / QC / Production Gate / Scheduler / Publisher
  ├── Media: FFmpeg composer / Subtitle / Artifacts / Provenance / Export
  └── Infra: SQLite (Alembic) / Filesystem projects/<id>/ / CredentialStore / Diagnostics
  ↓ HTTPS outbound only
Cloud AI providers (user BYOK) + Social platform APIs (future OAuth)
```

Không có proprietary remote server cho core. Domain layer phải deploy được lên `Remote FastAPI + PostgreSQL` mà không rewrite.

## 2. Module boundaries (bất khả xâm phạm ở Phase 0)

| Module | Owns | Không được phép |
|---|---|---|
| `ai.providers` | Provider Registry, adapter interface, capability declaration | Chứa business logic story/affiliate; hard-code key |
| `ai.models` | Model CRUD, priority, enabled, cost_class, license_status, health | Store secret trong model record; trả secret ra API |
| `ai.router` | Select + execute + fallback + circuit breaker + routing events. Core infrastructure, xây sớm nhất sau Foundation | Gọi model đầu tiên tìm thấy; fallback vô hạn; bypass cost/license |
| `ai.credentials` | CredentialStore `save/get/delete/exists/metadata`, encrypt at rest | Log/trả secret; gửi secret cho provider không liên quan |
| `story.factory` | Idea → Director Plan → Script → Scenes → Media → TTS → Subtitle → Render → QC → Gate → Scheduler → Publisher | Trộn affiliate data; auto publish khi `require_approval_before_publish=true` mà chưa approve |
| `affiliate.factory` | Product → Analysis → Script → Scenes → Media → TTS → Subtitle → Render → QC → Preview → Export. ISOLATED | Dùng Auto Pilot / Scheduler / Auto Publish mặc định; dùng kids-story character nếu không explicit |
| `automation.engine` | Queue, DAG execution, retry, cancel, pause/resume, concurrency, idempotency, recovery, audit | Chạy vô hạn khi lỗi liên tục; mất job khi restart |
| `autopilot` | Content Plan + policy + orchestration Story Factory (KHÔNG chứa render logic) | Chứa publisher logic trực tiếp; bypass Gate |
| `scheduler` | Stored schedules, due polling, timezone-aware fire, handoff cho publisher/queue | Publish trực tiếp lên platform; tự ý đổi timezone |
| `publisher` | Platform abstraction + publish jobs + status polling + retry có idempotency. Phase 0 CHỈ abstraction/contract | Hard-code platform logic vào UI; báo PUBLISHED giả |
| `media.ffmpeg` | Compose, normalize, scale, mix, concat, subtitle burn, thumbnail, validate. Arg array, không shell | `shell=True` với user input; đoán duration từ char count khi đã có real audio |
| `qc.gate` | QC checks → verdict; Production Gate → cho/block export/publish | Silent downgrade; PASS khi thiếu artifact |
| `observability` | Activity events, usage aggregates, diagnostics, provenance, notifications | Bịa cost/metric; lộ secret |

Dependency direction: `UI → API → Automation/Autopilot → Workflow Engine → Router/Media → Providers/FFmpeg`. Publisher/Scheduler không gọi ngược vào Router. Affiliate không import Story.

## 3. Hai Factory + Auto Pilot (chốt theo user)

Story Auto Pilot chính:

```text
Content Plan → Generate (Director→Scenes→Media→TTS→Subtitle→Compose)
→ QC → Production Gate → Scheduler → Publisher
```

`require_approval_before_publish`:
- `true` → job dừng ở `AWAITING_APPROVAL` sau Gate PASS, chờ `POST /autopilot/approvals` mới sang Scheduler.
- `false` → sau Gate PASS tự động sang Scheduler/Publisher.

Affiliate mặc định: không Auto Pilot, không Scheduler, không Auto Publish. Mở rộng sau cần proposal riêng + sign-off.

## 4. Job / Workflow state machine

Job (production unit, `JOB-YYYY-NNNNNN`):

```text
QUEUED → RUNNING → (SUCCEEDED | FAILED | CANCELLED)
RUNNING → PAUSED → RUNNING (automation-level pause/resume)
SUCCEEDED(Gate PASS, approval OFF) → SCHEDULED → PUBLISHING → PUBLISHED
SUCCEEDED(Gate PASS, approval ON) → AWAITING_APPROVAL → SCHEDULED → ...
Gate FAIL → BLOCKED (terminal, cần fix + retry tường minh)
FAILED → RETRYABLE (nếu còn retry budget + lỗi retryable) hoặc terminal
```

Node (DAG step: SCRIPT, SCENE_PLAN, IMAGE_GENERATION, VIDEO_GENERATION, TTS, SUBTITLE, COMPOSE, QC, GATE, SCHEDULE, PUBLISH):

```text
PENDING → WAITING_DEPS → READY → RUNNING → (SUCCEEDED | FAILED | SKIPPED_REUSE)
FAILED → RETRY_QUEUED (bounded) → RUNNING
```

Quy tắc: chỉ rerun node đổi + downstream; node có valid artifact (same input hash + model + params) → `SKIPPED_REUSE`, không regen. Persist `job state + node state + artifacts + attempts + provider/model + hashes + errors` để restart reuse.

Publish attempt (per platform):

```text
PENDING → QUEUED → SENDING → (CONFIRMED_PUBLISHED | RETRYABLE_ERROR | FATAL_ERROR)
RETRYABLE_ERROR → BACKOFF → QUEUED (bounded, idempotency-key giữ nguyên)
```

Không bao giờ chuyển sang `CONFIRMED_PUBLISHED` nếu platform API chưa xác nhận. Không retry duplicate (giữ idempotency key).

## 5. AI Router contract

Input: `{ task_type, required_capability, policy_snapshot(cost/license), manual_model_id?, idempotency_key, job_id }`.
Task types freeze Phase 0: `STORY_GENERATION, SCRIPT_GENERATION, SCRIPT_REWRITE, IMAGE_PROMPT, VISION_ANALYSIS, IMAGE_GENERATION, VIDEO_GENERATION, TTS, MUSIC, SFX, QC_VISION, QC_TEXT`.

Selection (thứ tự bắt buộc):
1. required capability → 2. enabled → 3. credential valid → 4. cost policy → 5. license policy → 6. health/cooldown/circuit → 7. sort theo strategy (`priority` mặc định deterministic; hỗ trợ `weighted/fastest/cheapest/auto` sau) → 8. execute → 9. classify → 10. fallback nếu retryable → 11. record event.

Failure classes freeze: `SUCCESS, BAD_REQUEST, AUTH_FAILED, PERMISSION_DENIED, RATE_LIMITED, QUOTA_EXHAUSTED, TIMEOUT, PROVIDER_UNAVAILABLE, MODEL_UNAVAILABLE, INVALID_RESPONSE, CONTENT_POLICY_BLOCK, NETWORK_ERROR, CREDENTIAL_MISSING, LICENSE_BLOCKED, PAID_MODEL_BLOCKED, UNKNOWN_ERROR`.

Fallback: chỉ khi `RATE_LIMITED, QUOTA_EXHAUSTED, TIMEOUT, PROVIDER_UNAVAILABLE, MODEL_UNAVAILABLE, NETWORK_ERROR, UNKNOWN_ERROR` (temporary). `BAD_REQUEST, AUTH_FAILED, CONTENT_POLICY_BLOCK, LICENSE_BLOCKED, PAID_MODEL_BLOCKED, CREDENTIAL_MISSING` → không fallback mù, trả typed error ngay. Bounded attempts + backoff + circuit `HEALTHY/DEGRADED/OPEN/HALF_OPEN` (threshold + cooldown configurable).

Event mỗi attempt: `{ request_id, job_id, task, provider, model, attempt, start/end, latency_ms, status, error_category, fallback_reason }`. Không secret.

## 6. Provider / Model abstraction

```text
Provider Registry → Provider Adapter (OpenRouter/OpenAI/Gemini/Anthropic/HF/ElevenLabs/Replicate/fal/Together/Groq/OpenAI-compatible/custom)
→ Model { id, provider_id, name, model_id, capabilities[], priority, enabled, cost_class, license_status, context_window, metadata, health_status, last_test_at }
→ Capability { TEXT, STORY, VISION, IMAGE, VIDEO, TTS, MUSIC, SFX, EMBEDDING }
```

Model record tham chiếu credential qua `credential_ref`, không embed secret. Capability không được assume — phải verify qua Test Connection theo capability (`REACHABLE / AUTHENTICATED / CAPABILITY_VERIFIED / FAILED / UNKNOWN`). `/models` public reachable ≠ generation verified.

## 7. Queue / Automation abstraction

Queue owns: enqueue (idempotency key required), dequeue theo priority + concurrency limit, lease/heartbeat, cancel, pause/resume toàn engine + per job, bounded retry, dead-letter sau hết budget, audit log, WS events (`job.started/stage_changed/provider_selected/fallback/progress/artifact_completed/qc_result/export_complete/error`).

`progress%` chỉ gửi khi backend tính được thật (bytes/frames/stage fraction). Nếu không biết → gửi `status_text` (`Generating voice...`), UI cấm tự chế %.

## 8. Scheduler abstraction (Phase 0, chưa worker live)

Entity `schedule`: `{ id, job_id/video_id, run_at, timezone, recurrence?, platforms[], account_refs, status }`. Engine poll due (timezone-aware, mặc định `Asia/Ho_Chi_Minh`), claim bằng lease để tránh double-fire, handoff sang Publisher. Trễ/miss → `MISSED` + audit, không fire bù âm thầm. Hủy/reschedule tường minh.

## 9. Publisher abstraction (Phase 0, CHỈ contract, chưa OAuth live)

```text
Publisher → PlatformAdapter { YouTube, TikTok, Facebook, Future }
```

Mỗi adapter khai báo `support_state: SUPPORTED | PARTIAL | NOT_SUPPORTED | CONFIG_REQUIRED` + `capabilities: [shorts/reels/schedule/description/hashtags]` + `publish(input, idempotency_key) → { platform_post_id | typed error } + status poll`.

Phase 0 cả 3 platform = `CONFIG_REQUIRED` (chưa adapter/live verification). Trả `NOT_SUPPORTED/CONFIG_REQUIRED` thật khi gọi. Tuyệt đối cấm trả `PUBLISHED` giả. Per-platform policy: `Manual only | Auto publish | Schedule only` + global `require production gate + valid account + prevent duplicate + bounded retry + stop after repeated failures`.

## 10. UI text abstraction (no i18n dep)

Không cài `i18next` ở Phase 0/1. Mọi string UI đi qua `t(key)` / `strings.vi.ts` dictionary đơn giản (`{ key: "Tiếng Việt" }`), key stable (`dashboard.title`, `autopilot.requireApproval`). Sau này thay implementation i18n mà không đổi call sites. Mặc định `vi`.

## 11. Non-goals Phase 0

Không UI, không migration, không worker, không FFmpeg wrapper, không OAuth live, không analytics collector, không marketplace/multi-user/cloud-sync. Không mock production flow — mock chỉ trong test và gắn nhãn `MOCK`.

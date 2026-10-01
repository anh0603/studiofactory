# ROADMAP — AI Short Factory Web Pro (Phase 0 sign-off candidate)

> Thứ tự: Foundation → AI Router (core, rất sớm) → Story → Pipeline → Automation → Scheduler → Publisher → Affiliate → Analytics → Hardening.
> Mỗi phase có gate `PASS/PARTIAL/BLOCKED/FAILED`, cấm `PASS` khi requirement essential bị block.

## Phase 0 — Architecture (HIỆN TẠI, chưa sign-off)

Mục tiêu: freeze contracts. Done khi 5 docs (`ARCHITECTURE/API_SPEC/DATA_MODEL/SECURITY/ROADMAP`) được bạn duyệt + git tag `phase0-signoff`. Cấm đổi contract sau đó nếu không có proposal.

## Phase 1 — Foundation

Mục tiêu: shell chạy thật. Chức năng: Vite+React+TS+Tailwind shell (sidebar/topbar/chỉ Diagnostics thật), FastAPI `/health`, SQLAlchemy+Alembic+SQLite migrate up/down, Query/Zustand wiring, `strings.vi.ts` abstraction (chưa i18n lib). Test: API health, migration, Playwright open. Không business feature.

## Phase 2 — AI Router (core infrastructure)

Chức năng: CredentialStore encrypted, provider/model CRUD, Test theo capability, Router select/fallback/circuit/activity, cost/license gate zero-request. Test: router matrix + secret-absent matrix. Done khi router testable độc lập, chưa video.

## Phase 3 — Story Factory

Projects/characters/scenes CRUD, Director Plan approve/edit/regen. Test workflow + snapshot.

## Phase 4 — Video Pipeline

Image (bytes/dims/hash/provenance), TTS (real audio→duration→subtitle), subtitle, FFmpeg compose+thumbnail+manifest. Test media matrix. Cấm fake artifact.

## Phase 5 — Automation Engine

DAG, incremental, queue + WS thật, pause/resume/cancel, recovery reuse. Test recovery matrix.

## Phase 6 — Scheduler

Due polling TZ-aware, lease claim, miss handling, handoff publisher. Test fire/miss/duplicate-guard.

## Phase 7 — Publisher

Adapter YT/TT/FB (từ `CONFIG_REQUIRED` lên dần), OAuth live (cần user duyệt riêng), idempotent retry, status poll. Test mock-labeled + production-reject-mock. Cấm PUBLISHED giả.

## Phase 8 — Affiliate Factory

Tables + API isolated, analysis/script/preview/export + disclosure. Test isolation.

## Phase 9 — Analytics

Activity/Usage/Health/Provenance viewer, aggregates honest (`UNKNOWN` khi thiếu). Test aggregation.

## Phase 10 — Hardening & Release

Secret scan, traversal/upload/SSRF/FFmpeg/CORS/WS tests, perf, E2E cloud thật (khi có user key), user guide. Release chỉ khi tests/build/E2E/security/router/recovery green.

## Sign-off gate Phase 0 (cần bạn duyệt)

1. Module boundaries + isolation Affiliate. 2. API contracts 7 nhóm + typed error. 3. State machines (job/node/publish). 4. Router + cost/license + idempotency/retry. 5. Publisher chỉ abstraction, 3 platform `CONFIG_REQUIRED`. 6. Không i18n dep, text abstraction, UI vi. 7. Không đổi contract sau sign-off.

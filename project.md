# AI SHORT FACTORY WEB PRO

## MASTER PROJECT SPECIFICATION — v1.0

> **Document status:** MASTER SPECIFICATION
> **Project type:** Local-first Web AI Video Production Studio
> **Primary platform:** Windows + modern Chromium browser
> **Architecture:** React/Vite + FastAPI + Cloud AI + FFmpeg
> **AI model strategy:** BYOK — Bring Your Own Key
> **Development principle:** Web-first, modular, observable, recoverable, production-safe
> **Primary language:** Vietnamese UI, multilingual-ready architecture
> **Current priority:** Build a professional web product from scratch; do not mechanically migrate the old Tauri application.

---

# 1. PRODUCT VISION

## 1.1 Product name

**AI Short Factory Web Pro**

The product is a professional AI-assisted short-video production studio.

It is NOT merely:

* a chatbot
* a prompt generator
* an automatic video generator
* an admin dashboard
* a collection of AI API forms

It is a complete production workflow:

```text
IDEA
 ↓
AI DIRECTOR
 ↓
STORY
 ↓
SCRIPT
 ↓
CHARACTERS
 ↓
SCENE PLAN
 ↓
IMAGE / VIDEO
 ↓
VOICE
 ↓
SUBTITLE
 ↓
MUSIC / SFX
 ↓
TIMELINE
 ↓
QC
 ↓
PRODUCTION GATE
 ↓
EXPORT
```

The user must be able to intervene at every important stage.

---

# 2. CORE PRODUCT PRINCIPLES

## 2.1 Web-first

The new project is a web/local-web application.

DO NOT use:

* Tauri
* Rust desktop shell
* Electron
* C#/WinUI
* desktop IPC
* embedded WebView
* dynamic backend port communication

Primary architecture:

```text
Browser
   ↓ HTTP / WebSocket
FastAPI
   ↓
AI / Media / Workflow Core
```

The browser is the UI.

FastAPI is the application backend.

FFmpeg and media processing execute on the local machine.

Cloud AI providers are external services.

---

# 3. LOCAL-FIRST MODEL

The first production target is:

```text
Windows PC
    │
    ├── Browser
    │
    ├── FastAPI
    │
    ├── SQLite
    │
    ├── FFmpeg
    │
    ├── Local filesystem
    │
    └── Cloud AI APIs
```

The application does not require a proprietary remote server for core operation.

Later, the same domain architecture must be deployable to:

```text
Browser
   ↓
Remote FastAPI
   ↓
PostgreSQL
   ↓
Cloud providers
```

without rewriting the domain layer.

---

# 4. AI MODEL STRATEGY

## 4.1 BYOK

The application must NOT depend on developer-owned AI API keys.

Users manage their own AI providers and models.

The user can:

* add provider
* enter API key
* discover models
* manually enter model ID
* select capabilities
* set priority
* enable/disable
* test connection
* edit
* delete
* inspect health
* choose routing policy

Example:

```text
Provider:
OpenRouter

API Key:
••••••••••••••••

Model:
openai/...

Capabilities:
TEXT
STORY
VISION

Priority:
100

Enabled:
ON
```

---

# 5. SUPPORTED PROVIDER ARCHITECTURE

Initial provider adapters should support, where technically available:

* OpenRouter
* OpenAI
* Google Gemini
* Anthropic
* Hugging Face
* ElevenLabs
* Replicate
* fal.ai
* Together
* Groq
* OpenAI-compatible providers
* custom provider adapters

The provider registry must be extensible.

DO NOT hard-code provider logic throughout business logic.

Use:

```text
Provider Registry
      ↓
Provider Adapter
      ↓
Model
      ↓
Capability
```

---

# 6. AI CAPABILITIES

Models may expose one or more capabilities:

```text
TEXT
STORY
VISION
IMAGE
VIDEO
TTS
MUSIC
SFX
EMBEDDING
```

The system must never assume a model supports a capability without verification.

---

# 7. MODEL RECORD

Each user-managed model should contain at least:

```text
id
provider_id
name
model_id
capabilities[]
priority
enabled
cost_class
license_status
context_window
metadata
health_status
last_test_at
created_at
updated_at
```

Never store API keys directly inside the model record.

Use a credential reference.

---

# 8. COST POLICY

Cost classes:

```text
LOCAL
FREE
FREE_WITH_LIMIT
TRIAL
PAID
UNKNOWN
```

Default production policy:

```text
LOCAL
FREE
FREE_WITH_LIMIT
```

are allowed.

These require explicit user configuration or policy:

```text
TRIAL
PAID
UNKNOWN
```

The application must NEVER silently spend money.

If a paid model is selected but paid usage is not explicitly allowed:

```text
BLOCKED_PAID_MODEL
```

---

# 9. LICENSE POLICY

License states:

```text
VERIFIED_COMMERCIAL
VERIFIED_NONCOMMERCIAL
UNKNOWN
UNVERIFIED
```

Production mode must reject:

```text
VERIFIED_NONCOMMERCIAL
UNKNOWN
UNVERIFIED
```

unless the user explicitly enters an appropriate non-production/testing mode.

Never claim a model is commercially safe without evidence.

---

# 10. CREDENTIAL SECURITY

API keys must:

* be encrypted at rest
* never be displayed after initial entry
* never appear in API responses
* never appear in frontend state unless strictly necessary
* never appear in URLs
* never appear in logs
* never appear in stack traces
* never appear in manifests
* never appear in provenance
* never appear in diagnostics
* never appear in analytics
* never be sent to unrelated AI models

Credential storage must use an abstraction:

```text
CredentialStore
 ├── save()
 ├── get()
 ├── delete()
 ├── exists()
 └── metadata()
```

The UI receives:

```text
credential_configured = true
```

rather than the secret itself.

---

# 11. PROJECT AI ROUTER

The Project AI Router is a core subsystem.

It must NOT simply call the first available model.

The Router must understand:

* capability
* task type
* priority
* health
* quota
* rate limits
* timeout
* cost
* license
* provider availability
* cooldown
* circuit breaker
* fallback policy
* model-specific constraints

---

# 12. ROUTER TASK TYPES

Initial task types:

```text
STORY_GENERATION
SCRIPT_GENERATION
SCRIPT_REWRITE
IMAGE_PROMPT
VISION_ANALYSIS
IMAGE_GENERATION
VIDEO_GENERATION
TTS
MUSIC
SFX
QC_VISION
QC_TEXT
```

---

# 13. ROUTER SELECTION PROCESS

For each request:

```text
1. Determine task type
2. Determine required capability
3. Find enabled models
4. Filter unsupported capability
5. Filter invalid credentials
6. Filter incompatible cost policy
7. Filter incompatible license policy
8. Filter unhealthy/cooldown models
9. Sort by priority/strategy
10. Execute
11. Classify result
12. Retry or fallback if appropriate
13. Record routing event
14. Return final result
```

---

# 14. FAILURE CLASSIFICATION

At minimum:

```text
SUCCESS

BAD_REQUEST
AUTH_FAILED
PERMISSION_DENIED
RATE_LIMITED
QUOTA_EXHAUSTED
TIMEOUT
PROVIDER_UNAVAILABLE
MODEL_UNAVAILABLE
INVALID_RESPONSE
CONTENT_POLICY_BLOCK
NETWORK_ERROR
CREDENTIAL_MISSING
LICENSE_BLOCKED
PAID_MODEL_BLOCKED
UNKNOWN_ERROR
```

---

# 15. FALLBACK RULES

Example:

```text
IMAGE REQUEST

Model A
  ↓
429 QUOTA
  ↓
Model B
  ↓
TIMEOUT
  ↓
Model C
  ↓
SUCCESS
```

Router must record:

```text
attempt 1 = Model A / QUOTA_EXHAUSTED
attempt 2 = Model B / TIMEOUT
attempt 3 = Model C / SUCCESS
```

The UI must expose this information.

---

# 16. DO NOT FALLBACK BLINDLY

A malformed request such as:

```text
400 BAD_REQUEST
```

must not automatically cause unlimited fallback.

The system should determine whether the error is:

* request-specific
* model-specific
* provider-specific

before retrying.

---

# 17. CIRCUIT BREAKER

Each model/provider can have:

```text
HEALTHY
DEGRADED
OPEN
HALF_OPEN
```

Example:

```text
3 consecutive provider failures
        ↓
OPEN CIRCUIT
        ↓
temporary cooldown
        ↓
health probe
        ↓
success
        ↓
HALF_OPEN
        ↓
HEALTHY
```

The threshold and cooldown must be configurable.

---

# 18. WEIGHTED ROUTING

Support:

```text
Priority routing
Weighted routing
Fastest routing
Cheapest routing
Auto routing
```

Example:

```text
Model A = 50%
Model B = 30%
Model C = 20%
```

The default should be deterministic priority routing because it is easiest to debug.

---

# 19. ROUTER OBSERVABILITY

Every AI request receives:

```text
request_id
job_id
task
provider
model
attempt
start_time
end_time
latency
status
error_category
fallback_reason
```

No secrets.

---

# 20. AI ACTIVITY CENTER

Create a dedicated page:

**AI Activity**

Example:

```text
19:03:21
STORY
OpenRouter / Model A
SUCCESS
1.8s

19:03:26
IMAGE
Provider A
QUOTA_EXHAUSTED

19:03:27
IMAGE
Provider B
SUCCESS
4.2s

19:03:32
TTS
ElevenLabs
SUCCESS
2.1s
```

The user can click an event to see:

* request type
* model
* latency
* status
* fallback chain
* error category

Never show API keys.

---

# 21. SMART AI ROUTING

The user can choose:

```text
AUTO
```

or:

```text
MANUAL MODEL
```

AUTO routing considers:

```text
Capability
Health
Priority
Latency
Quota
Cost
License
Task compatibility
```

---

# 22. PROJECT SYSTEM

Projects are first-class entities.

Each project contains:

```text
project_id
name
description
language
style
audience
duration
status
created_at
updated_at
```

Project statuses:

```text
DRAFT
GENERATING
REVIEW
READY
EXPORTING
COMPLETED
FAILED
ARCHIVED
```

---

# 23. PROJECT FILE STRUCTURE

Recommended local structure:

```text
projects/
└── <project-id>/
    ├── project.json
    ├── assets/
    ├── characters/
    ├── scenes/
    ├── audio/
    ├── subtitles/
    ├── renders/
    ├── exports/
    ├── provenance/
    └── logs/
```

The exact physical storage implementation may evolve, but logical separation must remain.

---

# 24. DASHBOARD

Dashboard must feel like a professional creative application.

Show:

```text
Projects
Videos
Production Queue
AI Health
Recent Activity
Usage
```

Example:

```text
AI SHORT FACTORY

● AI SYSTEM READY

Projects       Videos       Active Jobs
12             48           3
```

Recent Projects:

```text
Kids Adventure
6 scenes
Ready

Forest Mystery
5 scenes
Generating
```

---

# 25. UI DESIGN SYSTEM

Visual direction:

* dark-first
* professional
* minimal
* modern
* cinematic
* high information density without clutter
* subtle surfaces
* clear hierarchy
* consistent spacing
* accessible contrast

Avoid:

* excessive gradients
* excessive shadows
* giant rounded cards everywhere
* emoji as primary icons
* default browser buttons
* unstyled native inputs
* inconsistent border radii
* random colors

---

# 26. TYPOGRAPHY

Must support Vietnamese perfectly.

Use a modern Unicode-compatible system font stack.

Default body:

```text
14–16px
line-height around 1.5
```

Headings should have clear hierarchy.

No tiny unreadable labels.

---

# 27. GLOBAL UI STATES

Every asynchronous operation must support:

```text
IDLE
LOADING
SUCCESS
ERROR
RETRY
DISABLED
```

Never leave a button appearing clickable while an operation is running.

---

# 28. QUICK CREATE

Simple workflow:

```text
What do you want to create?

[ Một chú mèo cứu một chú chim trong rừng... ]

Duration:
30 sec

Audience:
Kids 6–9

Style:
3D Cartoon

Character:
Milo

Model:
AUTO

[ Generate ]
```

Output:

```text
Director Plan
```

before expensive generation begins.

---

# 29. AI DIRECTOR

AI Director converts an idea into a production plan.

Input:

```text
idea
duration
audience
language
style
tone
character
constraints
```

Output:

```text
TITLE
HOOK
STORY
SCENES
DIALOGUE
VISUAL PROMPTS
CAMERA
DURATION
ENDING
CTA
```

The user can:

```text
Approve
Edit
Regenerate
Change model
Regenerate only selected section
```

---

# 30. DIRECTOR PLAN

Do not immediately render everything.

Show:

```text
DIRECTOR PLAN

✓ Story
✓ Character
✓ Scene Plan
✓ Dialogue
✓ Visual Plan

6 scenes
Estimated 34 seconds

[ Review ]
[ Generate ]
```

This prevents unnecessary AI/API spending.

---

# 31. CHARACTER STUDIO

The user can create:

```text
Main Character
Supporting Character
```

Main character reference is uploaded by the user.

Store:

```text
character_id
reference_asset
asset_hash
description
face information
hair
clothes
colors
style
constraints
```

---

# 32. CHARACTER LOCK

Main character can have locks:

```text
Face
Hair
Clothes
Colors
Defining Features
```

The AI must not silently replace these.

If actual biometric/visual verification is unavailable:

```text
REVIEW_REQUIRED
```

or:

```text
UNSUPPORTED
```

Never fake verification.

---

# 33. SCENE STUDIO

Scene editor:

```text
Scene 03

[ Visual Preview ]

Duration:
4.8s

Camera:
Medium Shot

Motion:
Slow Push In

Characters:
Milo

Environment:
Forest

Dialogue:
"Mình phải cứu bạn ấy."

Visual Prompt:
[...]

[ Regenerate ]
[ Approve ]
```

---

# 34. SCENE ACTIONS

Each scene supports:

```text
Edit
Duplicate
Delete
Reorder
Regenerate Image
Regenerate Video
Regenerate Voice
Regenerate Subtitle
Approve
Reject
```

Regeneration must be dependency-aware.

Example:

```text
TTS failed
```

must not regenerate:

```text
Image
Character
Background
```

unless required.

---

# 35. WORKFLOW GRAPH

Internally model production as a graph:

```text
DIRECTOR
   ↓
SCRIPT
   ↓
SCENE PLAN
   ↓
IMAGE
   ↓
TTS
   ↓
SUBTITLE
   ↓
COMPOSE
   ↓
QC
   ↓
PRODUCTION GATE
   ↓
EXPORT
```

Every node has:

```text
node_id
type
status
input
output
dependencies
provider
model
attempts
duration
error
artifact
```

---

# 36. INCREMENTAL EXECUTION

Only changed nodes should rerun.

Example:

```text
Scene 3 image changed
```

Then:

```text
Scene 3 image
 ↓
Scene 3 compose
 ↓
Final compose
 ↓
QC
```

Do not rerun unrelated scenes.

---

# 37. TIMELINE

Create a lightweight timeline.

Tracks:

```text
VIDEO
VOICE
MUSIC
SFX
CAPTIONS
OVERLAYS
```

Support:

* reorder
* duration
* trim
* mute
* volume
* caption position
* transitions
* preview

The timeline is for short-video production, not a full Premiere replacement.

---

# 38. TTS

TTS must use the same Router.

Flow:

```text
TTS task
 ↓
Router
 ↓
User-selected cloud TTS model
 ↓
Real audio
 ↓
Measure actual duration
 ↓
Subtitle timing
 ↓
Video composition
```

Never estimate final duration from character count if real audio exists.

---

# 39. IMAGE GENERATION

Image generation must:

* use real provider responses
* validate bytes
* validate dimensions
* persist artifacts
* calculate hashes
* record provenance
* record provider/model
* record attempts
* never fake production output

---

# 40. VIDEO GENERATION

Video providers are optional capability adapters.

The architecture must allow:

```text
TEXT → VIDEO
IMAGE → VIDEO
SCENE → VIDEO
```

but unsupported providers must return:

```text
CAPABILITY_UNSUPPORTED
```

not fake success.

---

# 41. MUSIC AND SFX

Music and SFX are independent capabilities.

Each asset records:

```text
provider
model
license
source
duration
sha256
```

Commercial production requires valid licensing.

---

# 42. SUBTITLE ENGINE

Support:

```text
Vietnamese
English
future multilingual
```

Subtitle timing should derive from actual media duration.

Support:

```text
font
size
weight
position
safe area
animation preset
```

---

# 43. MEDIA ENGINE

Use FFmpeg.

Responsibilities:

```text
audio normalization
image scaling
video composition
subtitle rendering
audio mixing
scene rendering
concatenation
thumbnail generation
final validation
```

Never assume FFmpeg exists without checking.

Diagnostics must show:

```text
FFmpeg:
AVAILABLE

Version:
...

Path:
...
```

---

# 44. EXPORT

Export package:

```text
final.mp4
thumbnail.jpg
manifest.json
metadata.json
provenance/
licenses/
README.txt
```

Export must fail if mandatory production requirements are incomplete.

---

# 45. PROVENANCE

Every production artifact records:

```text
provider
model
capability
request_id
job_id
attempts
source asset hash
output hash
timestamp
license state
cost class
```

Never record:

```text
API key
credential
password
secret
```

---

# 46. QUALITY CONTROL

QC checks:

```text
Video exists
Video readable
Video duration
Resolution
Audio exists
Audio duration
Subtitle exists
Subtitle timing
Artifact integrity
Character policy
License
Disclosure
Provenance
```

Verdicts:

```text
PASS
REVIEW_REQUIRED
BLOCKED
```

---

# 47. PRODUCTION GATE

Production Gate is mandatory before final export.

Must check:

```text
Character
Media
Audio
Subtitle
Video
QC
Provenance
Disclosure
License
Cost policy
Export
```

Any mandatory failure:

```text
BLOCKED
```

No silent downgrade.

---

# 48. AI DISCLOSURE

Generated content must support configurable AI disclosure metadata.

The system must be able to include an AI-generated-content disclosure in the appropriate metadata/export flow.

---

# 49. AFFILIATE STUDIO

Affiliate Studio is a separate workflow.

Input:

```text
Product Image
Description
Optional URL
```

Output:

```text
Script
Preview
Revision
Export
```

Affiliate Studio must NOT automatically enter Story Auto Pilot.

It must NOT automatically publish.

It must NOT share kids-story characters or settings unless explicitly requested.

---

# 50. FTC / AFFILIATE DISCLOSURE

Affiliate outputs must support appropriate affiliate disclosure metadata/text.

Do not silently generate misleading commercial content.

---

# 51. AUTO PILOT

Auto Pilot is a production scheduler.

Workflow:

```text
Generate
 ↓
QC
 ↓
Production Gate
 ↓
Review / Auto Approve
 ↓
Export
```

Configuration:

```text
schedule
daily count
theme
character
language
duration
style
model strategy
approval policy
```

---

# 52. AUTO PILOT SAFETY

Auto Pilot must never silently:

* spend money
* use paid models without permission
* bypass license policy
* bypass QC
* bypass production gate
* publish unsupported platforms
* use invalid credentials

---

# 53. PRODUCTION QUEUE

Queue UI:

```text
#142
Milo's Adventure
██████████████░░ 78%
Generating Image

#141
Lost Bird
████████████████ 100%
READY

#140
Forest Mystery
██████░░░░░░░░░░ 32%
Generating TTS
```

Each job exposes:

```text
current stage
provider
model
progress
elapsed
retry
cancel
logs
artifacts
```

---

# 54. WEBSOCKET EVENTS

Use WebSocket for:

```text
job started
stage changed
provider selected
fallback
progress
artifact completed
QC result
export complete
error
```

Example:

```json
{
  "event": "job.stage_changed",
  "job_id": "...",
  "stage": "TTS",
  "status": "RUNNING"
}
```

---

# 55. RECOVERY

Jobs must survive application restart.

Persist:

```text
job state
node state
artifacts
attempts
provider
model
hashes
errors
```

If a valid artifact exists:

```text
REUSE
```

instead of regenerating.

---

# 56. DATABASE

Core entities:

```text
projects
characters
character_references
scenes
scene_assets
ai_providers
ai_models
credentials
jobs
job_events
artifacts
workflow_nodes
production_runs
qc_results
exports
usage_events
settings
```

Use:

```text
SQLAlchemy
Alembic
```

SQLite by default.

PostgreSQL-compatible architecture.

---

# 57. API ARCHITECTURE

Use:

```text
/api/v1/
```

Core routes:

```text
GET  /api/v1/health

GET  /api/v1/projects
POST /api/v1/projects
GET  /api/v1/projects/{id}
PATCH /api/v1/projects/{id}
DELETE /api/v1/projects/{id}

GET  /api/v1/characters
POST /api/v1/characters

GET  /api/v1/scenes
POST /api/v1/scenes

GET  /api/v1/ai/providers
GET  /api/v1/ai/models
POST /api/v1/ai/models
PATCH /api/v1/ai/models/{id}
DELETE /api/v1/ai/models/{id}
POST /api/v1/ai/models/{id}/test

POST /api/v1/director/generate

GET  /api/v1/jobs
GET  /api/v1/jobs/{id}
POST /api/v1/jobs/{id}/retry
POST /api/v1/jobs/{id}/cancel

GET  /api/v1/workflows/{id}

POST /api/v1/qc
POST /api/v1/export

GET  /api/v1/usage
GET  /api/v1/activity

GET  /api/v1/diagnostics
POST /api/v1/diagnostics/run
```

Generate OpenAPI documentation automatically.

---

# 58. ERROR CONTRACT

Every API error must be typed.

Example:

```json
{
  "error": {
    "code": "QUOTA_EXHAUSTED",
    "message": "Provider quota exhausted.",
    "request_id": "..."
  }
}
```

Never return:

```text
Internal Server Error
```

without useful structured context.

Never leak secrets.

---

# 59. FRONTEND DATA ARCHITECTURE

Use:

```text
TanStack Query
```

for server state.

Use:

```text
Zustand
```

or equivalent lightweight state management for UI/session state.

Do not create a giant global state object.

---

# 60. COMPONENT ARCHITECTURE

Organize frontend:

```text
components/
├── ui/
├── layout/
├── dashboard/
├── projects/
├── director/
├── characters/
├── scenes/
├── timeline/
├── queue/
├── ai-models/
├── activity/
├── diagnostics/
└── settings/
```

Pages:

```text
pages/
├── Dashboard
├── Projects
├── StoryStudio
├── Characters
├── SceneStudio
├── Timeline
├── ProductionQueue
├── AIModels
├── AutoPilot
├── AIActivity
├── Usage
├── Diagnostics
└── Settings
```

---

# 61. COMMAND PALETTE

Provide:

```text
Ctrl + K
```

Command palette.

Examples:

```text
Create Project
Generate Story
Open AI Models
Run Diagnostics
Open Queue
Start Auto Pilot
Export Current Project
```

---

# 62. KEYBOARD SHORTCUTS

At minimum:

```text
Ctrl + K
Ctrl + S
Ctrl + Z
Ctrl + Shift + Z
Space
Delete
Arrow navigation
```

Timeline shortcuts may be added later.

---

# 63. NOTIFICATION SYSTEM

Use professional toast/notification behavior.

Examples:

```text
✓ Model connected

⚠ Provider quota exhausted
Falling back to next model

✕ Export blocked
TTS artifact missing
```

Never show vague:

```text
Something went wrong
```

when more useful information exists.

---

# 64. EMPTY STATES

Every empty page needs useful onboarding.

Example:

```text
No projects yet.

Create your first AI short.

[ Create Project ]
```

Not a blank screen.

---

# 65. DIAGNOSTICS CENTER

Diagnostics checks:

```text
Frontend
Backend
Database
Migrations
FFmpeg
Storage
AI Router
Provider Registry
Credentials
Network
WebSocket
Filesystem
```

Example:

```text
✓ Backend
✓ Database
✓ FFmpeg
✓ Router
⚠ Hugging Face credential missing
✓ OpenRouter
```

---

# 66. DEBUG MODE

Development mode may expose:

```text
request ID
job ID
provider
model
timing
workflow node
```

Production mode must still protect secrets.

---

# 67. USAGE CENTER

Display:

```text
Requests
Successful
Failed
Fallbacks
Average latency
Provider usage
Model usage
Estimated cost
```

If cost is unknown:

```text
UNKNOWN
```

Never invent prices.

---

# 68. MODEL TEST CONNECTION

"Test Connection" must actually test the appropriate capability when possible.

Do not treat a public `/models` endpoint as proof that an API key can perform generation.

Test states:

```text
REACHABLE
AUTHENTICATED
CAPABILITY_VERIFIED
FAILED
UNKNOWN
```

For providers with public model lists:

```text
models endpoint reachable
```

does NOT automatically mean:

```text
generation verified
```

---

# 69. PROVIDER HEALTH

Provider health:

```text
HEALTHY
DEGRADED
RATE_LIMITED
AUTH_FAILED
UNAVAILABLE
UNKNOWN
```

Health should update from actual requests and health probes.

---

# 70. MODEL HEALTH

Model health:

```text
ACTIVE
COOLDOWN
DISABLED
AUTH_FAILED
QUOTA_EXHAUSTED
UNAVAILABLE
UNKNOWN
```

---

# 71. SECURITY

Security requirements:

* sanitize file paths
* prevent path traversal
* validate uploaded files
* validate MIME types
* limit file sizes
* sanitize logs
* scrub secrets
* validate provider URLs
* protect internal endpoints
* avoid SSRF through arbitrary provider URLs
* avoid command injection into FFmpeg
* validate all subprocess arguments
* never construct shell commands from raw user input

---

# 72. FILE UPLOAD SECURITY

Validate:

```text
extension
MIME
magic bytes
size
dimensions
```

For images:

```text
JPEG
PNG
WEBP
```

For audio/video, only explicitly supported formats.

---

# 73. FFmpeg SECURITY

Never run:

```text
shell=True
```

with untrusted user content.

Use argument arrays.

Validate paths.

Use temporary directories.

Clean up failed jobs.

---

# 74. OBSERVABILITY

Internal logging should use structured logs:

```json
{
  "timestamp": "...",
  "level": "INFO",
  "event": "router.fallback",
  "provider": "...",
  "model": "...",
  "request_id": "..."
}
```

Never log:

```text
API_KEY
Authorization
Bearer token
password
credential value
```

---

# 75. TESTING STRATEGY

Required:

```text
Unit tests
Integration tests
API tests
Router tests
Provider adapter tests
Credential tests
Workflow tests
Media tests
QC tests
Recovery tests
Frontend tests
Playwright E2E
```

---

# 76. ROUTER TEST MATRIX

Must test:

```text
Model A success

Model A quota
→ Model B success

Model A timeout
→ Model B success

Model A unavailable
→ Model B success

Model A auth failure
→ Model B

All models fail
→ typed failure

Paid model blocked
→ zero network request

License blocked
→ zero network request
```

---

# 77. SECURITY TEST MATRIX

Must verify:

```text
API key absent from response
API key absent from logs
API key absent from manifest
API key absent from provenance
API key absent from diagnostics
API key absent from error
```

---

# 78. MEDIA TEST MATRIX

Verify:

```text
real image bytes
real audio bytes
real duration
subtitle
FFmpeg composition
final video
thumbnail
manifest
hash
provenance
```

No fake production artifacts.

---

# 79. RECOVERY TEST MATRIX

Test:

```text
restart during story
restart during image
restart during TTS
restart during compose
restart during export
```

Existing valid artifacts must be reused.

---

# 80. PLAYWRIGHT E2E

Critical user flows:

```text
Open app
Create project
Add AI model
Test model
Generate story
Review Director Plan
Generate scene
Approve scene
Generate TTS
Preview
Run QC
Export
```

---

# 81. DEVELOPMENT PHASES

## PHASE 0 — PROJECT FOUNDATION

Deliver:

```text
Repository
README
PRODUCT_SPEC
ARCHITECTURE
UI_SPEC
API_SPEC
DATA_MODEL
SECURITY
ROADMAP
```

Create clean project structure.

Do not build business features yet.

---

# 82. PHASE 1 — WEB SHELL

Build:

```text
React
Vite
FastAPI
API client
routing
layout
navigation
design system
theme
responsive shell
```

Pages may initially contain placeholder states.

Must look professional.

---

# 83. PHASE 2 — DATABASE

Implement:

```text
SQLAlchemy
Alembic
SQLite
migrations
repositories
```

Test persistence.

---

# 84. PHASE 3 — AI MODEL MANAGER

Implement:

```text
provider registry
model registry
credential store
CRUD
model discovery
test connection
capability
priority
health
cost
license
```

This is the first real AI subsystem.

---

# 85. PHASE 4 — AI ROUTER

Implement:

```text
task routing
priority
fallback
timeouts
quota
rate limits
circuit breaker
health
activity events
```

No video production yet.

Router must be independently testable.

---

# 86. PHASE 5 — PROJECT SYSTEM

Implement:

```text
projects
assets
characters
scenes
snapshots
versions
```

---

# 87. PHASE 6 — AI DIRECTOR

Implement:

```text
idea
story
script
scene plan
director plan
review
regeneration
```

---

# 88. PHASE 7 — CHARACTER STUDIO

Implement:

```text
upload
reference
metadata
character lock
validation
```

Strict verification must be honest.

---

# 89. PHASE 8 — IMAGE / MEDIA

Implement:

```text
image generation
artifact persistence
hash
provenance
```

---

# 90. PHASE 9 — TTS

Implement:

```text
TTS Router
real audio
duration measurement
voice metadata
```

---

# 91. PHASE 10 — SUBTITLE

Implement:

```text
subtitle generation
timing
styles
rendering
```

---

# 92. PHASE 11 — VIDEO ENGINE

Implement:

```text
scene composition
audio
subtitle
FFmpeg
thumbnail
final video
```

---

# 93. PHASE 12 — SCENE STUDIO

Implement professional scene editing.

---

# 94. PHASE 13 — TIMELINE

Implement lightweight timeline.

---

# 95. PHASE 14 — WORKFLOW ENGINE

Implement:

```text
dependency graph
node status
incremental execution
artifact reuse
retry
recovery
```

---

# 96. PHASE 15 — PRODUCTION QUEUE

Implement:

```text
jobs
progress
WebSocket
cancel
retry
logs
```

---

# 97. PHASE 16 — QC + PRODUCTION GATE

Implement all production checks.

---

# 98. PHASE 17 — AUTO PILOT

Implement:

```text
schedule
batch
daily limits
approval policy
production queue
```

---

# 99. PHASE 18 — AFFILIATE STUDIO

Implement isolated affiliate workflow.

---

# 100. PHASE 19 — USAGE + ACTIVITY

Implement:

```text
AI Activity
Usage
Provider Health
Model Health
```

---

# 101. PHASE 20 — DIAGNOSTICS

Implement:

```text
System Health
Provider Health
FFmpeg
Database
Storage
Network
```

---

# 102. PHASE 21 — SECURITY HARDENING

Perform:

```text
secret scan
path traversal tests
upload validation
SSRF checks
FFmpeg safety
API validation
CORS
WebSocket security
```

---

# 103. PHASE 22 — FULL E2E

Run complete real cloud E2E where credentials are configured.

No fake provider.

No mock production output.

---

# 104. PHASE 23 — PERFORMANCE

Measure:

```text
frontend load
API latency
AI request latency
queue throughput
media composition
memory
large projects
large assets
```

---

# 105. PHASE 24 — RELEASE

Only after:

```text
Tests green
Build green
E2E green
Security green
UI verified
Media verified
Router verified
Recovery verified
```

Prepare:

```text
README
installation
configuration
troubleshooting
user guide
```

---

# 106. DEVELOPMENT RULES FOR AI CODING AGENTS

This project will be developed using AI coding agents.

Therefore agents MUST:

1. Read this entire specification before coding.
2. Inspect existing code before modifying it.
3. Never invent missing APIs.
4. Never invent provider capabilities.
5. Never claim tests passed without actually running them.
6. Never claim live provider verification without a real request.
7. Never fabricate credentials.
8. Never log credentials.
9. Never replace architecture without approval.
10. Never add unnecessary dependencies.
11. Never rewrite unrelated files.
12. Never perform destructive migrations without explicit approval.
13. Never silently introduce paid APIs.
14. Never use a paid model without policy approval.
15. Never fake Character Lock.
16. Never fake commercial licensing.
17. Never fake AI output.
18. Never silently bypass Production Gate.

---

# 107. AGENT PHASE REPORT FORMAT

After each phase, the coding agent must report:

```text
PHASE X REPORT

STATUS:
PASS / PARTIAL / BLOCKED / FAILED

Implemented:
...

Files changed:
...

Tests:
...

Build:
...

Live verification:
...

Skipped:
...

Known limitations:
...

Security:
...

Performance:
...

Next phase:
...
```

Never use:

```text
PASS
```

when an essential requirement is blocked.

---

# 108. NO-CREDENTIAL RULE

If a provider credential is missing:

```text
NOT_CONFIGURED
```

The system must:

* skip live request
* not invent a key
* not use another provider unless fallback is explicitly allowed
* report the exact missing configuration

---

# 109. NO-FREE-FICTION RULE

Never describe an AI service as:

```text
free
unlimited
commercial-safe
```

unless the current verified provider information supports it.

Use:

```text
FREE
FREE_WITH_LIMIT
PAID
UNKNOWN
```

as explicit states.

---

# 110. NO-FAKE-SUCCESS RULE

Production must never return:

```text
SUCCESS
```

from:

* mocks
* placeholder media
* fake API response
* synthetic dummy file
* skipped provider

unless the operation is explicitly marked as test/mock mode.

---

# 111. TEST / MOCK MODE

Mocks may exist for:

```text
unit tests
integration tests
offline orchestration
CI
```

But every mock result must be clearly identified.

Production mode must reject mock artifacts.

---

# 112. USER EXPERIENCE PRINCIPLE

The application should always tell the user:

```text
What is happening?
Why is it happening?
Which AI is being used?
How long has it taken?
What failed?
What will happen next?
Can I retry?
Can I change the model?
Will this cost money?
```

This is a core product principle.

---

# 113. AI REQUEST TRANSPARENCY

Before an expensive AI task, where practical:

```text
Model:
OpenRouter / Model X

Cost policy:
FREE_WITH_LIMIT

Fallback:
3 models

Estimated:
Unknown
```

If user has selected manual model, honor it.

If AUTO, explain the chosen model after routing.

---

# 114. USER CONTROL

The user must always be able to:

```text
Change model
Disable provider
Change priority
Retry
Cancel
Regenerate
Edit
Approve
Reject
Export
```

The AI must assist, not silently take control of the project.

---

# 115. PROJECT VERSIONING

Support:

```text
Snapshot
Duplicate
Restore
Undo
Redo
```

At minimum, preserve project state before major AI regeneration operations.

---

# 116. ARTIFACT HASHING

All production artifacts should support:

```text
sha256
size
mime
created_at
provider
model
```

This allows recovery and integrity verification.

---

# 117. ARTIFACT REUSE

If:

```text
same input
same model
same relevant parameters
same source hash
```

and a valid artifact exists:

```text
REUSE
```

instead of regenerating.

---

# 118. MODEL VERSION TRACKING

Provenance should include model ID and provider.

If provider exposes version information, store it.

Never claim exact version if unavailable.

---

# 119. NETWORK POLICY

Cloud AI calls only happen when:

```text
user configured a provider
```

or a test/mock environment explicitly permits it.

No hidden network calls.

No analytics by default.

---

# 120. OFFLINE BEHAVIOR

Without network:

```text
local project editing
local asset management
local timeline editing
local diagnostics
local database
```

must still work where possible.

Cloud generation should show:

```text
NETWORK_UNAVAILABLE
```

rather than hanging indefinitely.

---

# 121. RETRY POLICY

Retries must be bounded.

Default example:

```text
attempt 1
wait
attempt 2
wait
attempt 3
stop
```

Use exponential backoff where appropriate.

Do not retry permanent errors indefinitely.

---

# 122. REQUEST ID

Every important operation gets:

```text
request_id
```

This ID appears in:

* UI error
* backend log
* AI Activity
* job
* provenance

but contains no secret.

---

# 123. JOB ID

Every production operation gets:

```text
job_id
```

Example:

```text
JOB-2026-000142
```

---

# 124. USER-FACING ERROR EXAMPLE

Bad:

```text
Internal Server Error
```

Good:

```text
TTS failed

Provider:
Hugging Face

Reason:
QUOTA_EXHAUSTED

Router:
3 providers available

[ Retry ]
[ Change Model ]
[ View Activity ]
```

---

# 125. RESPONSIVE DESIGN

Primary:

```text
1280×720
1440×900
1920×1080
```

Minimum practical desktop width:

```text
1024px
```

Do not allow forms/tables to overflow the viewport.

Tables should use controlled horizontal scrolling.

---

# 126. ACCESSIBILITY

Support:

* keyboard navigation
* visible focus
* labels
* aria attributes where needed
* sufficient contrast
* readable text
* error association
* semantic buttons

---

# 127. BROWSER SUPPORT

Primary:

* Chrome
* Edge

Firefox support is desirable if no feature prevents it.

---

# 128. NO DESKTOP SHELL

The initial product must be a browser application.

Do not add:

```text
Tauri
Electron
```

just to make it feel like an app.

A desktop wrapper may be considered only after the web version is stable.

---

# 129. FUTURE EXTENSIONS

Architecture should leave room for:

```text
cloud sync
multi-user accounts
remote workers
GPU workers
team projects
provider marketplace
template marketplace
plugin system
remote rendering
cloud storage
publishing integrations
analytics
```

But these must NOT be implemented prematurely.

---

# 130. PUBLISHING

Publishing architecture may support:

```text
YouTube
TikTok
Facebook
Instagram
```

but each platform must have an explicit support state:

```text
SUPPORTED
PARTIAL
NOT_SUPPORTED
CONFIGURATION_REQUIRED
```

Never claim unsupported OAuth/publishing works.

Publishing must remain independent from video generation.

---

# 131. SOCIAL PUBLISHING SAFETY

Before publish:

```text
Production Gate
 ↓
Export
 ↓
Publish
```

Do not publish a blocked production artifact.

Retry must be bounded and idempotent.

---

# 132. ANALYTICS

Future analytics may include:

```text
videos generated
generation time
provider success rate
fallback rate
average latency
failure rate
export count
publishing status
```

Do not collect private user content by default.

---

# 133. PRIVACY

Local-first means:

* projects stay local by default
* media stays local by default
* credentials stay local
* no hidden telemetry
* cloud AI receives only data required for the selected task/provider

The UI should make provider data transfer understandable.

---

# 134. AI MODEL DATA FLOW

Example:

```text
User prompt
    ↓
Local FastAPI
    ↓
Router
    ↓
Selected cloud provider
    ↓
Response
    ↓
Local artifact/database
```

The application must not route data to unrelated providers.

---

# 135. MAIN USER FLOW

First-time user:

```text
Open browser
 ↓
Dashboard
 ↓
System Diagnostics
 ↓
Add AI Model
 ↓
Test Connection
 ↓
Create Project
 ↓
Choose Character
 ↓
Enter Idea
 ↓
AI Director
 ↓
Review Plan
 ↓
Generate
 ↓
Scene Studio
 ↓
Timeline
 ↓
QC
 ↓
Production Gate
 ↓
Export
```

---

# 136. POWER USER FLOW

```text
Create Project
 ↓
Advanced Workflow
 ↓
Select models
 ↓
Customize Router
 ↓
Generate
 ↓
Inspect Activity
 ↓
Modify scenes
 ↓
Run QC
 ↓
Export
```

---

# 137. AUTO PILOT FLOW

```text
Configure Auto Pilot
 ↓
Select theme
 ↓
Select character
 ↓
Select model strategy
 ↓
Set daily count
 ↓
Set schedule
 ↓
Run
 ↓
Queue
 ↓
Generate
 ↓
QC
 ↓
Gate
 ↓
Review / Auto Approve
 ↓
Export
```

---

# 138. PRIMARY SUCCESS CRITERIA

The project is successful when a new user can:

1. Open the web application.
2. Add a cloud AI provider.
3. Enter their own API key.
4. Discover/select a model.
5. Test the model.
6. Create a project.
7. Enter a simple idea.
8. Generate a Director Plan.
9. Review/edit the story.
10. Generate scenes.
11. Generate real media.
12. Generate real TTS.
13. Generate subtitles.
14. Compose a real video.
15. Run QC.
16. Pass Production Gate.
17. Export a real MP4.
18. Inspect which AI models were used.
19. Understand failures/fallbacks.
20. Resume after interruption.

---

# 139. NON-GOALS

Do NOT attempt to build:

* full Premiere Pro replacement
* full Blender replacement
* full Photoshop replacement
* generic AI chatbot platform
* arbitrary cloud infrastructure
* local LLM distribution
* automatic paid AI spending
* fake "one-click magic" without transparency

Focus on AI short-video production.

---

# 140. FINAL ARCHITECTURE

```text
                    AI SHORT FACTORY WEB PRO
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
       CREATIVE            AI CORE            PRODUCTION
          │                   │                   │
          │              AI Router                │
          │              Provider Registry        │
          │              Model Manager            │
          │              Credentials              │
          │                   │                   │
          ▼                   ▼                   ▼
       Director          Cloud AI              Workflow
       Story             Providers             Queue
       Character         Models                Recovery
       Scene             Fallback              QC
       Timeline          Health                Gate
                                             Export
          │                   │                   │
          └───────────────────┼───────────────────┘
                              │
                           FastAPI
                              │
                    ┌─────────┴─────────┐
                    │                   │
                 SQLite              FFmpeg
                    │                   │
                    └─────────┬─────────┘
                              │
                           Browser
                       React + Vite
```

---

# 141. FINAL TECHNOLOGY STACK

## Frontend

```text
React
TypeScript
Vite
Tailwind CSS
component library
TanStack Query
Zustand
WebSocket
Playwright
Vitest
```

## Backend

```text
Python
FastAPI
Pydantic
SQLAlchemy
Alembic
WebSocket
Pytest
```

## Media

```text
FFmpeg
Pillow / equivalent image processing
subtitle engine
```

## Database

```text
SQLite
PostgreSQL-compatible architecture
```

## AI

```text
Project Router
Provider Registry
BYOK
Cloud AI
Fallback
Health
Circuit Breaker
Usage
Provenance
```

---

# 142. ABSOLUTE PROJECT RULES

These rules override convenience.

```text
1. No Tauri.
2. No Electron.
3. No local AI model installation.
4. No hard-coded AI credentials.
5. BYOK is mandatory.
6. No hidden paid AI calls.
7. No fake free claims.
8. No fake model availability.
9. No fake license claims.
10. No fake Character Lock verification.
11. No fake production artifacts.
12. No secret leakage.
13. No unlimited retry loops.
14. No silent fallback when policy forbids it.
15. No destructive migration without approval.
16. No unnecessary dependencies.
17. No unnecessary architecture changes.
18. No unverified production PASS.
19. No mock artifact in production.
20. No unsupported social platform reported as supported.
21. Affiliate workflow remains isolated.
22. Production Gate cannot be bypassed.
23. User controls model/key/provider selection.
24. Router must remain project-owned.
25. The application must explain failures clearly.
26. Real cloud verification must use real user-provided credentials.
27. Every phase must produce an honest PASS/PARTIAL/BLOCKED/FAILED report.
```

---

# 143. MASTER DEVELOPMENT COMMAND

The coding agent must interpret this document as the project source of truth.

When starting work:

```text
1. Read this specification completely.
2. Inspect repository.
3. Produce architecture report.
4. Identify conflicts.
5. Do not code until architecture is understood.
6. Implement only the current phase.
7. Run tests.
8. Run build.
9. Verify UI.
10. Report exact results.
```

Do not attempt to implement every phase in one operation.

---

# 144. FIRST TASK FOR THE CODING AGENT

Before implementing any feature:

### STEP 1

Create a clean repository.

### STEP 2

Create:

```text
README.md
docs/PRODUCT_SPEC.md
docs/ARCHITECTURE.md
docs/UI_SPEC.md
docs/AI_ROUTER_SPEC.md
docs/API_SPEC.md
docs/DATA_MODEL.md
docs/SECURITY.md
docs/ROADMAP.md
```

`PRODUCT_SPEC.md` must contain this master specification.

### STEP 3

Create initial project structure.

### STEP 4

Create frontend shell.

### STEP 5

Create FastAPI shell.

### STEP 6

Create health endpoint.

### STEP 7

Create frontend → backend API connection.

### STEP 8

Create design system.

### STEP 9

Run tests.

### STEP 10

Stop and report Phase 0/1.

Do not implement AI generation until the foundation is verified.

---

# 145. DEFINITION OF DONE

A feature is DONE only when:

```text
Implementation
+
Tests
+
Error handling
+
Security
+
UI state
+
Documentation
+
Build
+
Verification
```

are complete.

A feature that merely "works on the happy path" is not considered complete.

---

# 146. FINAL PRODUCT DESCRIPTION

AI Short Factory Web Pro is a local-first professional AI short-video production studio.

Users bring their own cloud AI credentials.

Users choose models.

The Project AI Router intelligently selects and rotates models according to capability, priority, health, quota, cost and license.

The AI Director transforms ideas into editable production plans.

Characters remain controlled by explicit character policies.

Scenes are independently editable and regeneratable.

A dependency-aware workflow prevents unnecessary regeneration.

Real TTS, images, video, subtitles and FFmpeg composition produce real artifacts.

QC and Production Gate prevent invalid exports.

Auto Pilot enables repeatable production.

AI Activity explains exactly what the system is doing.

Diagnostics makes the system easy to debug.

The product remains transparent about cost, quota, licensing and provider limitations.

The application is web-first, local-first, cloud-AI-powered, BYOK, modular and designed for long-term expansion.

# END OF MASTER SPECIFICATION

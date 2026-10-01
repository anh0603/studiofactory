# AI SHORT FACTORY WEB PRO

## UI/UX DESIGN SPECIFICATION — V2.0

> **Product type:** AI Video Automation & Publishing Platform
> **Platform:** Web Application
> **Primary goal:** Tự động tạo video ngắn bằng AI, kiểm tra, render, lập lịch và tự động đăng lên các nền tảng.
> **Secondary goal:** Tạo video Affiliate theo một workflow riêng biệt.
> **Design direction:** Premium / Professional / Automation-first / AI-native.

---

# 1. PRODUCT VISION

AI Short Factory không phải một chatbot AI, không phải một video editor thông thường và cũng không phải một dashboard quản trị.

Đây là một:

> **AI Video Factory có khả năng tự động sản xuất và phân phối video ngắn.**

Người dùng có thể:

```text
Ý tưởng
  ↓
AI lập kế hoạch
  ↓
AI viết kịch bản
  ↓
AI tạo cảnh
  ↓
AI tạo hình/video
  ↓
AI Voice
  ↓
Subtitle
  ↓
Render
  ↓
QC
  ↓
Production Gate
  ↓
Schedule
  ↓
Auto Publish
  ↓
YouTube / TikTok / Facebook
```

Người dùng có thể:

* làm thủ công;
* bán tự động;
* hoặc bật Auto Pilot để hệ thống tự chạy.

---

# 2. TWO FACTORIES

Sản phẩm phải có **2 Factory độc lập**.

## 2.1 Story Video Factory

Dùng để tạo video content thông thường.

Ví dụ:

* Kids stories
* Educational Shorts
* Storytelling
* Funny stories
* Animals
* Mini animation
* Facts
* Motivation
* Entertainment
* Custom niche

Workflow:

```text
Topic
→ Idea
→ Story
→ Director Plan
→ Characters
→ Scenes
→ Media
→ Voice
→ Subtitle
→ Render
→ QC
→ Publish
```

---

# 2.2 Affiliate Video Factory

Affiliate là một sản phẩm riêng.

Không trộn UI với Story Factory.

Input:

```text
Product image
Product name
Product description
Affiliate URL
Optional product information
```

AI có thể tạo:

* Hook
* Sales script
* Product review
* UGC-style script
* Problem → Solution
* Product showcase
* Comparison
* Top product
* Before/After
* Storytelling advertisement

Workflow:

```text
Product
→ AI Product Analysis
→ Content Angle
→ Script
→ Scenes
→ Product Visuals
→ Voice
→ Subtitle
→ Render
→ QC
→ Preview
→ Export
```

Affiliate Factory mặc định:

* không Auto Pilot;
* không Scheduler;
* không Auto Publish.

Có thể mở rộng sau này nếu có yêu cầu riêng.

---

# 3. CORE AUTOMATION ENGINE

Đây là thành phần quan trọng nhất của hệ thống.

Không thiết kế Auto Pilot như một trang setting đơn giản.

Auto Pilot phải là một **Automation Engine**.

```text
                    AUTOMATION ENGINE
                           │
              ┌────────────┴────────────┐
              │                         │
       STORY FACTORY              AFFILIATE FACTORY
              │
              ↓
        CONTENT PLAN
              ↓
         AI DIRECTOR
              ↓
        VIDEO PIPELINE
              ↓
             QC
              ↓
      PRODUCTION GATE
              ↓
          SCHEDULER
              ↓
          PUBLISHER
              ↓
       PLATFORM APIs
```

Engine phải hỗ trợ:

* queue;
* dependencies;
* retry;
* cancellation;
* pause/resume;
* scheduling;
* concurrency limits;
* provider fallback;
* failure recovery;
* idempotency;
* job history;
* audit log.

---

# 4. MAIN NAVIGATION

Desktop-first.

Sidebar:

```text
┌──────────────────────────┐
│ AI SHORT FACTORY         │
│                          │
│ OVERVIEW                 │
│                          │
│ 🏠 Dashboard             │
│                          │
│ 🎬 STORY FACTORY         │
│    Projects              │
│    Content                │
│    Characters             │
│    Scenes                 │
│    Timeline               │
│                          │
│ 🛒 AFFILIATE FACTORY     │
│    Products               │
│    Affiliate Videos       │
│                          │
│ ⚡ AUTOMATION             │
│    Auto Pilot             │
│    Queue                  │
│    Scheduler              │
│    Publisher              │
│                          │
│ 🤖 AI                     │
│    Models                 │
│    Router                 │
│    Activity               │
│    Usage                  │
│                          │
│ 📊 ANALYTICS             │
│                          │
│ ⚙ SYSTEM                 │
│    Connections            │
│    Diagnostics            │
│    Settings               │
└──────────────────────────┘
```

Sidebar phải có thể collapse.

---

# 5. GLOBAL TOP BAR

Top bar:

```text
[Project / Factory selector]

[Search / Ctrl+K]

[Automation status]

[AI Router status]

[Notifications]

[User]
```

Automation status:

```text
● RUNNING
```

hoặc:

```text
Ⅱ PAUSED
```

hoặc:

```text
! ATTENTION
```

Không được hiển thị trạng thái giả.

---

# 6. DASHBOARD

Dashboard là **Automation Command Center**.

Không phải dashboard thống kê đơn thuần.

## 6.1 Hero section

```text
Good evening

Your factory is running.

[ Create Story ]
[ Create Affiliate Video ]

Auto Pilot
● RUNNING
```

---

## 6.2 Today's automation

```text
TODAY

Videos planned       12
Generating            3
QC                     1
Ready                  2
Scheduled              4
Published              7
Failed                 0
```

---

## 6.3 Production pipeline

Hiển thị realtime:

```text
IDEAS
  12
   ↓
SCRIPTS
   9
   ↓
SCENES
   7
   ↓
RENDER
   4
   ↓
QC
   2
   ↓
READY
   2
   ↓
SCHEDULED
   4
   ↓
PUBLISHED
   7
```

---

## 6.4 Upcoming automation

```text
NEXT RUN

20:00
Generate 3 Story Videos

21:30
Publish:
YouTube + TikTok + Facebook
```

---

## 6.5 Recent videos

Card:

```text
┌────────────────────────────┐
│       VIDEO THUMBNAIL      │
│                            │
├────────────────────────────┤
│ The Little Fox             │
│ Story Factory              │
│                            │
│ ● Published                │
│ YouTube · TikTok           │
│                            │
│ 20:00                      │
└────────────────────────────┘
```

---

# 7. STORY FACTORY

Story Factory phải là workflow chính.

## 7.1 Create Story

Màn hình:

```text
CREATE STORY

What do you want to create?

[ Describe your idea... ]

Examples:
• A funny story about a clever cat
• Educational story for kids 6–9
• 30-second animal adventure

Content preset
[ Kids Story ▼ ]

Target duration
[ 30s ▼ ]

Language
[ Vietnamese ▼ ]

[ Continue ]
```

---

# 8. AI DIRECTOR

Sau khi nhập ý tưởng, AI không được lập tức tạo video.

AI tạo:

```text
DIRECTOR PLAN
```

Gồm:

### Story concept

### Target audience

### Tone

### Hook

### Story structure

### Characters

### Scene list

### Voice direction

### Visual style

### Estimated duration

Ví dụ:

```text
SCENE 01
Duration: 5s
Location: Forest
Character: Main Character
Action: Walking
Camera: Wide shot
Dialogue: ...
```

Người dùng:

```text
[ Approve ]

[ Edit ]

[ Regenerate ]
```

---

# 9. CHARACTER STUDIO

Main character phải được quản lý riêng.

## Character card

```text
┌─────────────────────────┐
│       CHARACTER         │
│                         │
│        IMAGE            │
│                         │
├─────────────────────────┤
│ Main Character          │
│                         │
│ 🔒 Character Locked     │
│                         │
│ Face      ✓             │
│ Hair      ✓             │
│ Clothing  ✓             │
└─────────────────────────┘
```

Main Character:

* upload reference;
* multiple reference images;
* description;
* visual identity;
* lock;
* validation;
* replacement.

Không được tự ý thay đổi nhân vật chính.

Nếu verification không đủ tin cậy:

```text
REVIEW REQUIRED
```

Không được giả vờ rằng Character Lock đã thành công.

---

# 10. SCENE STUDIO

Scene Studio hiển thị:

```text
┌──────────────┬──────────────────────┬──────────────┐
│ SCENE LIST   │      PREVIEW         │ SCENE INFO   │
│              │                      │              │
│ 01 ✓         │                      │ Location     │
│ 02 ✓         │       IMAGE          │ Characters   │
│ 03 ...       │                      │ Action       │
│ 04           │                      │ Camera       │
│              │                      │ Dialogue     │
└──────────────┴──────────────────────┴──────────────┘
```

Actions:

* Generate
* Regenerate
* Edit prompt
* Lock
* Approve
* Reject
* Replace media

---

# 11. VIDEO TIMELINE

Timeline chuyên nghiệp.

Tracks:

```text
VIDEO
████████████████████████

VOICE
██████████████████

MUSIC
████████████████████

SFX
   ██    ███     ██

SUBTITLE
████████████████████████
```

Controls:

* play;
* pause;
* seek;
* zoom;
* split;
* trim;
* reorder;
* mute;
* volume;
* subtitle editing.

Timeline là editor hỗ trợ production, không cần cố thay thế Premiere/CapCut.

---

# 12. VIDEO GENERATION PIPELINE

Mọi video phải có Job Pipeline.

```text
QUEUED
 ↓
SCRIPT
 ↓
SCENE_PLAN
 ↓
IMAGE_GENERATION
 ↓
VIDEO_GENERATION
 ↓
TTS
 ↓
SUBTITLE
 ↓
COMPOSE
 ↓
QC
 ↓
PRODUCTION_GATE
 ↓
READY
```

Mỗi stage phải có:

* status;
* start time;
* end time;
* provider;
* model;
* retry count;
* error;
* output.

---

# 13. PRODUCTION QUEUE

Queue phải là trung tâm vận hành.

```text
JOB                 STATUS       PROVIDER       ACTION

Fox Story           Rendering    OpenRouter     View
Cat Story           QC           Vision-A       View
Robot Story         Queued       —              Cancel
Animal Story        Failed       TTS-A          Retry
```

Filters:

* Running
* Queued
* Completed
* Failed
* Cancelled
* Review Required

---

# 14. AUTO PILOT

Auto Pilot là màn hình cực kỳ quan trọng.

## 14.1 Status

```text
AUTO PILOT

● RUNNING

Today's target
[ 5 videos ]

Completed
3 / 5
```

---

## 14.2 Content plan

```text
CONTENT PLAN

Frequency:
[ 5 / day ]

Generation window:
08:00 — 22:00

Topics:
[ Animals ]
[ Kids ]
[ Education ]

Randomization:
[ Enabled ]
```

---

## 14.3 Automatic workflow

```text
☑ Generate ideas
☑ Generate scripts
☑ Generate scenes
☑ Generate media
☑ Generate voice
☑ Render
☑ QC
☑ Production Gate
☑ Schedule
☑ Publish
```

---

## 14.4 Safety controls

```text
Max retries/job
[ 2 ]

Max concurrent jobs
[ 3 ]

Allow paid models
[ OFF ]

Require approval before publishing
[ OFF ]

Stop automation after
[ 3 consecutive failures ]
```

---

# 15. SCHEDULER

Scheduler phải là một module độc lập.

Calendar:

```text
MON    TUE    WED    THU    FRI
──────────────────────────────────
10:00
       Video 01

14:00
Video 02

18:00
Video 03        Video 04
```

Có:

* day;
* time;
* timezone;
* platform;
* account;
* content;
* status.

---

# 16. PUBLISHER

Publisher là một module riêng.

## Platform connections

```text
YouTube
● Connected

TikTok
● Connected

Facebook
● Connected

Instagram
○ Not connected
```

Mỗi platform có:

* OAuth connection;
* account/channel;
* permissions;
* connection status;
* token expiry;
* reconnect.

Không được giả lập kết nối.

---

# 17. PUBLISH JOB

```text
PUBLISH

Video:
The Little Fox

Platforms:

☑ YouTube Shorts
☑ TikTok
☑ Facebook Reels

Publish:
○ Now
● Schedule

Date:
24/09/2026

Time:
20:00

Timezone:
Asia/Ho_Chi_Minh

Title:
...

Description:
...

Hashtags:
...

[ Schedule Publish ]
```

---

# 18. PUBLISH STATUS

Sau khi đăng:

```text
The Little Fox

YouTube      ✓ Published
TikTok       ✓ Published
Facebook     ⚠ Retry

Reason:
Temporary API error

Next retry:
20:05
```

Không báo “Published” nếu API chưa xác nhận.

---

# 19. PUBLISH FAILURE

Ví dụ:

```text
PUBLISH FAILED

TikTok API
HTTP 429

Reason:
Rate limit

Action:
[ Retry ]
[ Reschedule ]
[ Disable Platform ]
```

Hệ thống phải giữ idempotency để retry không tạo bài đăng trùng.

---

# 20. AFFILIATE FACTORY

Affiliate có dashboard riêng.

```text
AFFILIATE FACTORY

[ + New Product ]

Products
────────────────────────────

[ IMAGE ]
Wireless Earbuds
$29.99

Videos: 8
Draft: 2
Exported: 6
```

---

# 21. PRODUCT WORKSPACE

```text
PRODUCT

[ Product Image ]

Name
Description
Price
Affiliate URL

Target audience
Tone
Video style
```

AI Product Analysis:

```text
Key benefits
Potential hooks
Pain points
Target audience
Content angles
```

---

# 22. AFFILIATE SCRIPT GENERATOR

Cho phép chọn:

```text
CONTENT STYLE

○ Review
○ UGC
○ Problem → Solution
○ Product Showcase
○ Comparison
○ Storytelling
○ Top Product
```

AI tạo:

* Hook;
* Body;
* CTA;
* disclosure.

Người dùng được sửa trước khi render.

---

# 23. AFFILIATE VIDEO PREVIEW

```text
┌──────────────────────┐
│                      │
│       VIDEO          │
│                      │
│                      │
├──────────────────────┤
│ Product: XYZ         │
│                      │
│ [ Edit Script ]      │
│ [ Regenerate ]       │
│ [ Export ]            │
└──────────────────────┘
```

Không có Auto Publish trong workflow mặc định.

---

# 24. AI MODEL CENTER

Người dùng tự cấu hình AI.

```text
AI MODELS

Provider      Model             Capability      Status

OpenRouter    model-x           TEXT            ✓
Provider A    image-model       IMAGE           ✓
Provider B    tts-model         TTS             ✓
```

---

# 25. ADD AI MODEL

Wizard:

```text
STEP 1
Provider

STEP 2
API Key

STEP 3
Model

STEP 4
Capabilities

STEP 5
Routing Policy

STEP 6
Test

STEP 7
Save
```

API key:

```text
sk-********************
```

Không hiển thị lại secret đầy đủ sau khi lưu.

---

# 26. AI ROUTER

Router là core infrastructure.

UI:

```text
AI ROUTER

Strategy:
[ Auto ▼ ]

Priority

1. Model A
2. Model B
3. Model C
```

Fallback:

```text
MODEL A
   │
   ├── SUCCESS → DONE
   │
   └── 429
        ↓
MODEL B
   │
   ├── TIMEOUT
   ↓
MODEL C
   │
   └── SUCCESS
```

Router phải fallback khi:

* quota;
* rate limit;
* timeout;
* temporary server error;
* model unavailable;
* provider unavailable;
* invalid configuration;
* capability mismatch.

Không fallback vô hạn.

---

# 27. COST CONTROL

Mỗi model có:

```text
Cost class

FREE
FREE_WITH_LIMIT
TRIAL
PAID
UNKNOWN
```

Default production:

```text
Allow paid models
OFF
```

Không được tự động phát sinh chi phí ngoài cấu hình người dùng.

---

# 28. LICENSE CONTROL

Mỗi provider/model:

```text
License:

VERIFIED_COMMERCIAL
VERIFIED_NONCOMMERCIAL
UNKNOWN
UNVERIFIED
```

Production Mode có thể:

```text
☑ Block unknown licenses
☑ Block non-commercial models
```

Không tuyên bố commercial-safe nếu chưa xác minh.

---

# 29. AI ACTIVITY

Hiển thị mọi AI request quan trọng.

```text
AI ACTIVITY

10:22
TEXT
Model A
429 QUOTA

10:22
TEXT
Model B
TIMEOUT

10:23
TEXT
Model C
✓ SUCCESS
```

Có:

* provider;
* model;
* capability;
* latency;
* status;
* retry;
* fallback;
* job ID.

Không bao giờ hiển thị API key.

---

# 30. USAGE

```text
USAGE

Today
──────────────

AI requests       142
Successful        137
Fallbacks           8
Failures            5

Estimated cost
$0.00
```

Nếu không có dữ liệu cost:

```text
Cost: UNKNOWN
```

Không bịa số.

---

# 31. ANALYTICS

Analytics phải theo dõi:

### Production

* videos created;
* videos published;
* failed jobs;
* average generation time;
* QC failures.

### Publishing

* published;
* failed;
* retries;
* scheduled;
* platform status.

### Content

* video count;
* topic;
* duration;
* format.

Nếu platform API cung cấp analytics:

* views;
* likes;
* comments;
* shares;
* retention;
* engagement.

Không hiển thị metric chưa được platform xác nhận.

---

# 32. CONNECTION CENTER

Quản lý:

```text
AI Providers
Social Accounts
Storage
Publishing Accounts
```

Mỗi connection:

```text
● CONNECTED

Last verified:
10:32

[ Test ]
[ Reconnect ]
[ Disconnect ]
```

---

# 33. NOTIFICATION CENTER

Notifications:

```text
✓ Video published
⚠ TikTok publish retry
⚠ AI quota reached
✓ Auto Pilot completed
! Production Gate blocked
```

Click notification → mở đúng Job/Video.

---

# 34. COMMAND PALETTE

`Ctrl + K`

Actions:

```text
Create Story
Create Affiliate Video
Run Auto Pilot
Pause Auto Pilot
Open Queue
Open Scheduler
Add AI Model
Connect YouTube
Connect TikTok
Connect Facebook
Open Router
Open Diagnostics
```

---

# 35. JOB DETAIL

Mọi automation job phải có trang chi tiết.

```text
JOB #10291

The Little Fox

STATUS
● RUNNING

PIPELINE

✓ Script
✓ Scene Plan
✓ Images
● Voice
○ Render
○ QC
○ Publish
```

Có:

* logs;
* AI activity;
* retry;
* outputs;
* errors;
* timestamps;
* provider;
* model;
* cost;
* artifacts.

---

# 36. REAL-TIME JOB VIEW

Không fake progress.

Nếu backend không biết phần trăm:

```text
Generating voice...

Status:
RUNNING
```

Không được tự hiển thị:

```text
73%
```

nếu 73% không phải dữ liệu thật.

---

# 37. ERROR UX

Mọi lỗi phải có 3 phần:

```text
WHAT HAPPENED
WHY
WHAT YOU CAN DO
```

Ví dụ:

```text
Image generation failed

Provider returned HTTP 429.

The configured model has reached
its rate limit.

[ Retry ]
[ Use fallback model ]
[ Open Router ]
```

---

# 38. EMPTY STATES

Ví dụ:

```text
No AI models configured

Add your first cloud AI model
to start generating videos.

[ Add AI Model ]
```

Không để trang trống.

---

# 39. LOADING STATES

Loading phải phản ánh task thật:

```text
Connecting...
Testing model...
Generating script...
Rendering video...
Checking publish status...
```

Không fake progress.

---

# 40. MOBILE

Desktop-first.

Mobile không cố nhồi toàn bộ dashboard.

Mobile ưu tiên:

* monitoring;
* job status;
* notifications;
* Auto Pilot;
* scheduler;
* approve/reject.

Video editing đầy đủ ưu tiên desktop.

---

# 41. DESIGN SYSTEM

## Primary color

```text
#FF6B35
```

## Dark background

```text
#0B0D10
```

## Surface

```text
#12161C
```

## Border

```text
#252B34
```

## Text

```text
Primary: #F5F7FA
Secondary: #9AA4B2
Muted: #667085
```

Không dùng gradient quá mức.

Orange chỉ dùng làm accent/action.

---

# 42. VISUAL STYLE

Phong cách:

* premium;
* cinematic;
* professional;
* minimal;
* dense nhưng dễ đọc;
* dark-first;
* subtle motion;
* clear hierarchy.

Không:

* giao diện admin cũ;
* card bo tròn quá mức;
* gradient lòe loẹt;
* icon ngẫu nhiên;
* giant text;
* native browser controls chưa style;
* dashboard quá nhiều màu.

---

# 43. RESPONSIVE BREAKPOINTS

```text
≥ 1440px
Full workspace

1280–1439px
Compact workspace

1024–1279px
Collapsed sidebar

< 1024px
Mobile/tablet fallback
```

---

# 44. ACCESSIBILITY

Phải hỗ trợ:

* keyboard navigation;
* visible focus;
* aria labels;
* semantic buttons;
* sufficient contrast;
* reduced motion;
* screen reader basics.

---

# 45. SECURITY UX

API key:

* masked;
* never logged;
* never displayed after save;
* never sent unnecessarily to browser;
* delete action requires confirmation.

OAuth:

* show connected account;
* token status;
* reconnect;
* disconnect.

---

# 46. PRODUCTION GATE

Trước khi publish:

```text
PRODUCTION CHECK

✓ Script exists
✓ Video rendered
✓ Audio exists
✓ Subtitle exists
✓ Duration valid
✓ Aspect ratio valid
✓ Character validation passed
✓ Required disclosure present
✓ Platform metadata valid
✓ License policy passed

READY TO PUBLISH
```

Nếu fail:

```text
BLOCKED

Reason:
Character validation failed.

[ Review ]
```

---

# 47. CONTENT SAFETY / KIDS MODE

Story Factory có:

```text
Audience

Kids 4–6
Kids 6–9
Kids 9–12
General
```

Kids mode phải có:

* age preset;
* content constraints;
* safe prompt policy;
* privacy-conscious handling;
* no unnecessary personal data;
* disclosure controls.

Không tuyên bố tuân thủ pháp luật nếu chưa có implementation/legal review.

---

# 48. AUTO PUBLISH POLICY

Mỗi platform phải có:

```text
Publishing permission

○ Manual only
● Auto publish
○ Schedule only
```

Global safety:

```text
☑ Require production gate
☑ Require valid account
☑ Prevent duplicate publish
☑ Retry temporary failures
☑ Stop after repeated failures
```

---

# 49. PLATFORM ABSTRACTION

Publisher không được hard-code toàn bộ logic vào UI.

Architecture UI phải phản ánh abstraction:

```text
Publisher
 ├── YouTube
 ├── TikTok
 ├── Facebook
 └── Future providers
```

Nếu một platform chưa hỗ trợ:

```text
NOT SUPPORTED

This publisher integration is not currently available.
```

Không giả lập.

---

# 50. VIDEO ASSET LIBRARY

Quản lý:

* generated images;
* uploaded characters;
* audio;
* videos;
* subtitles;
* thumbnails;
* exports.

Filters:

```text
Images
Videos
Audio
Characters
Projects
Exports
```

---

# 51. VERSION HISTORY

Mỗi video có:

```text
Version 1
Version 2
Version 3
```

Có thể:

* restore;
* compare;
* duplicate;
* regenerate.

---

# 52. PROVENANCE

Mỗi generated video có manifest:

```text
VIDEO
 ├── Story
 ├── Prompt
 ├── Models
 ├── Providers
 ├── Assets
 ├── Voice
 ├── Music
 ├── Subtitle
 ├── Render settings
 └── Publish history
```

Không đưa secret vào manifest.

---

# 53. AUTOMATION HISTORY

Hiển thị:

```text
AUTO PILOT HISTORY

09:00
Generated 3 videos
✓ 3 success

12:00
Generated 2 videos
✓ 1 success
⚠ 1 review required

18:00
Publishing
✓ YouTube
✓ TikTok
⚠ Facebook retry
```

---

# 54. DIAGNOSTICS

System health:

```text
Backend             ● Healthy
Database            ● Healthy
Storage             ● Healthy
AI Router            ● Healthy
Publisher            ● Healthy
Scheduler             ● Healthy
Worker                ● Healthy
```

Health phải lấy từ backend thật.

---

# 55. SETTINGS

Sections:

```text
General
AI
Router
Storage
Automation
Publishing
Notifications
Security
Kids Mode
Affiliate
Advanced
```

---

# 56. FRONTEND COMPONENT ARCHITECTURE

```text
src/
├── components/
│   ├── ui/
│   ├── layout/
│   ├── dashboard/
│   ├── story/
│   ├── affiliate/
│   ├── characters/
│   ├── scenes/
│   ├── timeline/
│   ├── automation/
│   ├── scheduler/
│   ├── publisher/
│   ├── ai/
│   ├── analytics/
│   └── system/
│
├── pages/
│   ├── Dashboard
│   ├── StoryFactory
│   ├── AffiliateFactory
│   ├── Characters
│   ├── Scenes
│   ├── Timeline
│   ├── Queue
│   ├── AutoPilot
│   ├── Scheduler
│   ├── Publisher
│   ├── AIModels
│   ├── AIRouter
│   ├── Activity
│   ├── Analytics
│   └── Settings
│
├── hooks/
├── stores/
├── api/
├── types/
└── utils/
```

---

# 57. CORE USER JOURNEYS

## Journey A — Manual Story

```text
Dashboard
→ Story Factory
→ Idea
→ AI Director
→ Approve
→ Generate
→ QC
→ Render
→ Export
```

---

## Journey B — Automatic Story

```text
Dashboard
→ Auto Pilot
→ Configure
→ Enable
→ Content Plan
→ Generate
→ QC
→ Production Gate
→ Schedule
→ Publish
```

---

## Journey C — Affiliate

```text
Affiliate Factory
→ Product
→ AI Analysis
→ Script
→ Generate
→ Preview
→ Edit
→ Export
```

---

## Journey D — Automatic publishing

```text
Video Ready
→ Scheduler
→ Publisher
→ Platform API
→ Confirmation
→ Published
```

---

# 58. AUTO PILOT MASTER FLOW

Đây là workflow quan trọng nhất của sản phẩm:

```text
                  ┌───────────────┐
                  │   AUTO PILOT  │
                  └───────┬───────┘
                          ↓
                   CONTENT PLAN
                          ↓
                    IDEA ENGINE
                          ↓
                   STORY ENGINE
                          ↓
                  DIRECTOR ENGINE
                          ↓
                   SCENE ENGINE
                          ↓
                 MEDIA GENERATION
                          ↓
                    TTS ENGINE
                          ↓
                  SUBTITLE ENGINE
                          ↓
                  VIDEO COMPOSER
                          ↓
                         QC
                          ↓
                  PRODUCTION GATE
                          ↓
                     SCHEDULER
                          ↓
                    PUBLISHER
                          ↓
              ┌───────────┼───────────┐
              ↓           ↓           ↓
           YouTube      TikTok      Facebook
              ↓           ↓           ↓
                    PUBLISH RESULT
                          ↓
                       ANALYTICS
```

---

# 59. AI ROUTER MASTER FLOW

```text
AI TASK
   ↓
CAPABILITY
   ↓
ELIGIBLE MODELS
   ↓
LICENSE FILTER
   ↓
COST FILTER
   ↓
ROUTING POLICY
   ↓
MODEL A
   │
   ├── SUCCESS
   │
   └── FAILURE
          ↓
       MODEL B
          │
          ├── SUCCESS
          │
          └── FAILURE
                 ↓
              MODEL C
                 │
                 └── SUCCESS
```

Router phải có:

* retry budget;
* timeout;
* backoff;
* circuit breaker;
* provider health;
* quota awareness;
* capability matching;
* cost policy;
* license policy.

---

# 60. UX RULES

## Rule 1

Người dùng phải biết hệ thống đang làm gì.

## Rule 2

Người dùng phải biết lỗi vì sao.

## Rule 3

Không fake trạng thái.

## Rule 4

Không fake AI.

## Rule 5

Không tự động tiêu tiền.

## Rule 6

Không báo publish thành công nếu platform chưa xác nhận.

## Rule 7

Không che giấu fallback.

## Rule 8

Không để Auto Pilot chạy vô hạn khi hệ thống gặp lỗi liên tục.

## Rule 9

Mọi automation đều phải có pause/stop.

## Rule 10

Affiliate và Story phải là hai workflow riêng.

---

# 61. DEFINITION OF DONE

UI được xem là hoàn thành khi:

* Dashboard hoạt động;
* Story Factory hoạt động;
* Affiliate Factory hoạt động;
* Character Studio hoạt động;
* Scene Studio hoạt động;
* Timeline hoạt động;
* Automation Queue hoạt động;
* Auto Pilot hoạt động;
* Scheduler hoạt động;
* Publisher hoạt động;
* AI Model Center hoạt động;
* AI Router hoạt động;
* Usage hoạt động;
* Analytics hoạt động;
* Connection Center hoạt động;
* Diagnostics hoạt động;
* Error states đầy đủ;
* Loading states đầy đủ;
* Empty states đầy đủ;
* Responsive;
* Keyboard accessible;
* Không có fake data trong production;
* Không có fake progress;
* Không có fake connection;
* Không có fake publish result.

---

# 62. FINAL PRODUCT STRUCTURE

```text
AI SHORT FACTORY WEB PRO
│
├── DASHBOARD
│
├── STORY FACTORY
│   ├── Projects
│   ├── Content
│   ├── Characters
│   ├── Scenes
│   ├── Timeline
│   └── Exports
│
├── AFFILIATE FACTORY
│   ├── Products
│   ├── Scripts
│   ├── Videos
│   └── Exports
│
├── AUTOMATION
│   ├── Auto Pilot
│   ├── Queue
│   ├── Scheduler
│   └── Publisher
│
├── AI
│   ├── Models
│   ├── Router
│   ├── Activity
│   └── Usage
│
├── ANALYTICS
│
└── SYSTEM
    ├── Connections
    ├── Diagnostics
    ├── Notifications
    └── Settings
```

---

# 63. DESIGN PRIORITY

Thứ tự ưu tiên khi implement:

```text
P0 — CORE AUTOMATION

1. Story Factory
2. Video Pipeline
3. Queue
4. AI Router
5. Auto Pilot
6. Scheduler
7. Publisher

P1 — CREATIVE TOOLS

8. Character Studio
9. Scene Studio
10. Timeline
11. Asset Library

P2 — AFFILIATE

12. Affiliate Factory
13. Product Workspace
14. Affiliate Script Engine
15. Affiliate Export

P3 — OPERATIONS

16. Analytics
17. Usage
18. Diagnostics
19. Activity
20. Provenance

P4 — POLISH

21. Command Palette
22. Advanced UX
23. Keyboard shortcuts
24. Responsive
25. Accessibility
```

---

# 64. IMPLEMENTATION PRINCIPLE

Coding agent phải hiểu:

> **Không xây một dashboard có chức năng AI.**

Phải xây:

> **Một AI Video Automation Factory có giao diện dashboard chuyên nghiệp.**

Mọi UI đều phải kết nối với backend thật.

Mọi action quan trọng phải tạo ra operation thật.

Ví dụ:

```text
[Generate Video]
        ↓
POST /jobs
        ↓
Queue
        ↓
Worker
        ↓
AI Router
        ↓
Pipeline
        ↓
Output
```

Không tạo nút chỉ để trang trí.

---

# 65. FINAL EXPERIENCE

Người dùng mới mở app:

```text
Dashboard
    ↓
Connect AI Models
    ↓
Connect Social Accounts
    ↓
Create Story Factory
    ↓
Set Character
    ↓
Set Content Rules
    ↓
Set Daily Video Count
    ↓
Set Publish Schedule
    ↓
Enable Auto Pilot
    ↓
SYSTEM RUNS
```

Sau đó người dùng chủ yếu:

```text
Monitor
↓
Approve exceptions
↓
Review analytics
```

Đây mới là trải nghiệm **AI Short Factory** đúng nghĩa.

---

# 66. FINAL DESIGN STATEMENT

AI Short Factory Web Pro phải tạo cảm giác:

> **“Tôi thiết lập nhà máy một lần, sau đó AI tự sản xuất và phân phối video cho tôi.”**

Chứ không phải:

> “Tôi phải ngồi điều khiển từng video bằng tay.”

Story Factory là **content production engine**.

Affiliate Factory là **commercial content engine**.

Automation Engine là **bộ não vận hành**.

AI Router là **hệ thống AI infrastructure**.

Scheduler + Publisher là **distribution engine**.

Dashboard là **control center**.

Đây là cấu trúc UX/UI chuẩn cần được dùng làm **source of truth cho toàn bộ frontend implementation**.

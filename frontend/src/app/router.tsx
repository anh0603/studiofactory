import { createBrowserRouter } from 'react-router-dom'
import { Shell } from '../layouts/shell'
import { AffiliatePage } from '../pages/affiliate'
import { AiModelsPage } from '../pages/ai-models'
import { AiRouterPage } from '../pages/ai-router'
import { AnalyticsPage } from '../pages/analytics'
import { AutopilotPage } from '../pages/autopilot'
import { DashboardPage } from '../pages/dashboard'
import { DiagnosticsPage } from '../pages/diagnostics'
import { JobDetailPage } from '../pages/job-detail'
import { PlaceholderPage } from '../pages/placeholder'
import { PublisherPage } from '../pages/publisher'
import { QueuePage } from '../pages/queue'
import { SchedulerPage } from '../pages/scheduler'
import { SettingsPage } from '../pages/settings'
import { StoryDetailPage } from '../pages/story-detail'
import { StoryProjectsPage } from '../pages/story'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'story', element: <StoryProjectsPage /> },
      { path: 'story/:projectId', element: <StoryDetailPage /> },
      { path: 'queue', element: <QueuePage /> },
      { path: 'queue/:jobId', element: <JobDetailPage /> },
      { path: 'autopilot', element: <AutopilotPage /> },
      { path: 'scheduler', element: <SchedulerPage /> },
      { path: 'publisher', element: <PublisherPage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
      { path: 'diagnostics', element: <DiagnosticsPage /> },
      { path: 'affiliate', element: <AffiliatePage /> },
      { path: 'ai/models', element: <AiModelsPage /> },
      { path: 'ai/router', element: <AiRouterPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
])

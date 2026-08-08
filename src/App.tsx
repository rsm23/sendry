import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/app-shell'
import { AppSkeleton } from '@/components/app-skeleton'
import { useAuth } from '@/lib/auth'

const LoginPage = lazy(() => import('@/pages/login'))
const SetupPage = lazy(() => import('@/pages/setup'))
const ResetPasswordPage = lazy(() => import('@/pages/reset-password'))
const OverviewPage = lazy(() => import('@/pages/overview'))
const CampaignsPage = lazy(() => import('@/pages/campaigns'))
const ComposerPage = lazy(() => import('@/pages/composer'))
const ReportPage = lazy(() => import('@/pages/report'))
const TemplatesPage = lazy(() => import('@/pages/templates'))
const AudiencesPage = lazy(() => import('@/pages/audiences'))
const AudiencePage = lazy(() => import('@/pages/audience'))
const AutomationsPage = lazy(() => import('@/pages/automations'))
const RulesPage = lazy(() => import('@/pages/rules'))
const FilesPage = lazy(() => import('@/pages/files'))
const SettingsPage = lazy(() => import('@/pages/settings'))
const InboxPage = lazy(() => import('@/pages/inbox'))
const ChannelCampaignPage = lazy(() => import('@/pages/channel-campaign'))
const ChatWidgetPage = lazy(() => import('@/pages/chat-widget'))
const ChannelsPage = lazy(() => import('@/pages/channels'))

function ProtectedApp() {
  const { user, loading } = useAuth()
  if (loading) return <AppSkeleton />
  if (!user) return <Navigate to="/login" replace />
  return <AppShell />
}

export default function App() {
  return (
    <Suspense fallback={<AppSkeleton />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route element={<ProtectedApp />}>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/campaigns" element={<CampaignsPage />} />
          <Route path="/campaigns/new" element={<ChannelCampaignPage />} />
          <Route path="/campaigns/new/:channel" element={<ChannelCampaignPage />} />
          <Route path="/campaigns/:campaignId" element={<ComposerPage />} />
          <Route path="/campaigns/:campaignId/report" element={<ReportPage />} />
          <Route path="/reports" element={<CampaignsPage reportsOnly />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/audiences" element={<AudiencesPage />} />
          <Route path="/audiences/:listId" element={<AudiencePage />} />
          <Route path="/automations" element={<AutomationsPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/channels" element={<ChannelsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="/widget/:publicKey" element={<ChatWidgetPage />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </Suspense>
  )
}

// Root router — lazy routes, UserProvider, Suspense fallback.
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { UserProvider } from './context/UserContext'
import { Skeleton } from './components/ui'
import {
  Wand2, CheckSquare, Newspaper, BarChart3, BookOpen,
  MessageSquare, Shield,
} from 'lucide-react'
import { StubRoute } from './routes/stub/StubRoute'

const Landing            = lazy(() => import('./routes/Landing'))
const SignIn             = lazy(() => import('./routes/SignIn'))
const MustChangePassword = lazy(() => import('./routes/MustChangePassword'))
const AppShell           = lazy(() => import('./routes/AppShell'))
const ShareView          = lazy(() => import('./routes/ShareView'))
const Home               = lazy(() => import('./routes/Home'))
const Products           = lazy(() => import('./routes/Products'))
const Explorer           = lazy(() => import('./routes/Explorer'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-svh bg-page gap-3">
      <Skeleton className="w-48 h-3" />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <UserProvider>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public */}
            <Route path="/"                      element={<Landing />} />
            <Route path="/sign-in"               element={<SignIn />} />
            <Route path="/must-change-password"  element={<MustChangePassword />} />
            <Route path="/share/:token"          element={<ShareView />} />

            {/* Authenticated shell */}
            <Route path="/app" element={<AppShell />}>
              <Route index                element={<Home />} />
              <Route path="products"      element={<Products />} />
              <Route path="products/:id/*" element={<Products />} />
              <Route path="builder"       element={<StubRoute title="AI Builder" description="Generate product structures, draft coverage language and validate rules with Claude — coming soon." icon={Wand2} />} />
              <Route path="explorer"      element={<Explorer />} />
              <Route path="tasks"         element={<StubRoute title="Task Board" description="Kanban tracking for the product development lifecycle from Ideation through Launch." icon={CheckSquare} />} />
              <Route path="news"          element={<StubRoute title="Market News" description="AI-curated regulatory updates and competitor filings relevant to your product portfolio." icon={Newspaper} />} />
              <Route path="claims"        element={<StubRoute title="Claims Analysis" description="Loss-ratio trends and emerging risk signals to inform product repricing decisions." icon={BarChart3} />} />
              <Route path="dictionary"    element={<StubRoute title="Data Dictionary" description="Canonical field definitions used across all products — the single source of truth for data governance." icon={BookOpen} />} />
              <Route path="feedback"      element={<StubRoute title="Feedback" description="Ideas, issues and praise from the team. Vote to prioritise; ADMIN manages status." icon={MessageSquare} />} />
              <Route path="admin"         element={<StubRoute title="Settings" description="User management, custom claims, audit log explorer and system configuration." icon={Shield} />} />
            </Route>

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </UserProvider>
    </BrowserRouter>
  )
}

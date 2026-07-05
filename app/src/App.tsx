// Root router — lazy routes, UserProvider, Suspense fallback.
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { UserProvider } from './context/UserContext'
import { Skeleton } from './components/ui'
import { ErrorBoundary } from './components/ErrorBoundary'
import { IconWand, IconChart } from './components/ui/icons'
import { StubRoute } from './routes/stub/StubRoute'

const Landing            = lazy(() => import('./routes/Landing'))
const SignIn             = lazy(() => import('./routes/SignIn'))
const MustChangePassword = lazy(() => import('./routes/MustChangePassword'))
const AppShell           = lazy(() => import('./routes/AppShell'))
const ShareView          = lazy(() => import('./routes/ShareView'))
const Home               = lazy(() => import('./routes/Home'))
const Products           = lazy(() => import('./routes/Products'))
const Explorer           = lazy(() => import('./routes/Explorer'))
const ProductWorkspace   = lazy(() => import('./routes/product/ProductWorkspace'))
const ProductOverview    = lazy(() => import('./routes/product/ProductOverview'))
const ProductCoverages   = lazy(() => import('./routes/product/ProductCoverages'))
const ProductForms       = lazy(() => import('./routes/product/ProductForms'))
const ProductPricing     = lazy(() => import('./routes/product/ProductPricing'))
const ProductStates      = lazy(() => import('./routes/product/ProductStates'))
const ProductRules       = lazy(() => import('./routes/product/ProductRules'))
const Tasks              = lazy(() => import('./routes/Tasks'))
const Dictionary         = lazy(() => import('./routes/Dictionary'))
const Admin              = lazy(() => import('./routes/Admin'))
const Feedback           = lazy(() => import('./routes/Feedback'))
const News               = lazy(() => import('./routes/News'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-svh bg-page">
      <Skeleton className="w-48 h-3" />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <UserProvider>
        <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/"                      element={<Landing />} />
            <Route path="/sign-in"               element={<SignIn />} />
            <Route path="/must-change-password"  element={<MustChangePassword />} />
            <Route path="/share/:token"          element={<ShareView />} />

            <Route path="/app" element={<AppShell />}>
              <Route index                element={<Home />} />
              <Route path="products"      element={<Products />} />

              {/* Product workspace — nested tabs */}
              <Route path="products/:id" element={<ProductWorkspace />}>
                <Route index                element={<Navigate to="overview" replace />} />
                <Route path="overview"      element={<ProductOverview />} />
                <Route path="coverages"     element={<ProductCoverages />} />
                <Route path="forms"         element={<ProductForms />} />
                <Route path="pricing"       element={<ProductPricing />} />
                <Route path="states"        element={<ProductStates />} />
                <Route path="rules"         element={<ProductRules />} />
              </Route>

              <Route path="builder"    element={<StubRoute title="AI Builder" description="Generate product structures, draft coverage language and validate rules with Claude — coming soon." icon={IconWand} />} />
              <Route path="explorer"   element={<Explorer />} />
              <Route path="tasks"      element={<Tasks />} />
              <Route path="news"       element={<News />} />
              <Route path="claims"     element={<StubRoute title="Claims Analysis" description="Loss-ratio trends and emerging risk signals." icon={IconChart} />} />
              <Route path="dictionary" element={<Dictionary />} />
              <Route path="feedback"   element={<Feedback />} />
              <Route path="admin"      element={<Admin />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        </ErrorBoundary>
      </UserProvider>
    </BrowserRouter>
  )
}

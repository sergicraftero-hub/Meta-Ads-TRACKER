import { StrictMode, lazy, Suspense, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './styles.css'
import { StoreProvider, useStore } from './lib/store'
import { AppLayout } from './components/Layout'
import { LoadingGrid } from './components/ui'
import Landing from './pages/Landing'
import Auth from './pages/Auth'
import Overview from './pages/Overview'

const Campaigns = lazy(() => import('./pages/Campaigns'))
const Creatives = lazy(() => import('./pages/Creatives'))
const Recommendations = lazy(() => import('./pages/Recommendations'))
const AiAnalyst = lazy(() => import('./pages/AiAnalyst'))
const Accounts = lazy(() => import('./pages/Accounts'))
const Attribution = lazy(() => import('./pages/Attribution'))
const Tracking = lazy(() => import('./pages/Tracking'))
const Settings = lazy(() => import('./pages/Settings'))
const Billing = lazy(() => import('./pages/Billing'))

function Protected({ children }: { children: ReactNode }) {
  const { me, meLoaded } = useStore()
  if (!meLoaded) return null
  return me ? children : <Navigate to="/login" replace />
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { me, meLoaded } = useStore()
  if (!meLoaded) return null
  return me ? <Navigate to="/app" replace /> : children
}

const page = (el: ReactNode) => <Suspense fallback={<LoadingGrid />}>{el}</Suspense>

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<GuestOnly><Auth mode="login" /></GuestOnly>} />
          <Route path="/register" element={<GuestOnly><Auth mode="register" /></GuestOnly>} />
          <Route path="/app" element={<Protected><AppLayout /></Protected>}>
            <Route index element={<Overview />} />
            <Route path="campaigns" element={page(<Campaigns />)} />
            <Route path="creatives" element={page(<Creatives />)} />
            <Route path="recommendations" element={page(<Recommendations />)} />
            <Route path="ai" element={page(<AiAnalyst />)} />
            <Route path="accounts" element={page(<Accounts />)} />
            <Route path="attribution" element={page(<Attribution />)} />
            <Route path="tracking" element={page(<Tracking />)} />
            <Route path="settings" element={page(<Settings />)} />
            <Route path="billing" element={page(<Billing />)} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  </StrictMode>
)

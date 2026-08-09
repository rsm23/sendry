import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from 'sonner'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from '@/lib/auth'
import { I18nProvider } from '@/i18n/i18n'
import { useI18n } from '@/i18n/context'

function LocalizedToaster() {
  const { direction } = useI18n()
  return <Toaster richColors position={direction === 'rtl' ? 'bottom-left' : 'bottom-right'} />
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false },
  },
})

const router = createBrowserRouter([{
  path: '*',
  element: (
    <TooltipProvider>
      <AuthProvider>
        <App />
        <LocalizedToaster />
      </AuthProvider>
    </TooltipProvider>
  ),
}])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
)

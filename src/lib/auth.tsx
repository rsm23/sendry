import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, get, post } from '@/lib/api'
import { resolveLocale } from '@/i18n/catalog'
import { useI18n, type ThemePreference } from '@/i18n/context'

export type User = { id: string; name: string; email: string; language: string; timezone: string; theme: string }
export type Brand = { id: string; workspace_id: string; name: string; from_name: string; from_email: string; reply_to: string; provider: string; [key: string]: unknown }
export type Workspace = { id: string; name: string; company: string; default_timezone: string; default_language: string; rows_per_page: number; strict_delete: boolean; api_enabled: boolean }
type Bootstrap = { user: User | null; brands: Brand[]; workspaces: Workspace[]; capabilities: Record<string, boolean> }
type AuthContextValue = {
  user: User | null
  brands: Brand[]
  workspaces: Bootstrap['workspaces']
  brand: Brand | null
  loading: boolean
  login: (email: string, password: string, code?: string) => Promise<{ requiresTwoFactor?: boolean }>
  logout: () => Promise<void>
  selectBrand: (brandId: string) => void
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setLocale, setTheme } = useI18n()
  const [bootstrap, setBootstrap] = useState<Bootstrap>({ user: null, brands: [], workspaces: [], capabilities: {} })
  const [brandId, setBrandId] = useState(() => localStorage.getItem('sendry_brand') ?? '')
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    try {
      const data = await get<Bootstrap>('/api/bootstrap')
      setBootstrap(data)
      setBrandId((current) => data.brands.some((brand) => brand.id === current) ? current : data.brands[0]?.id ?? '')
    } catch { setBootstrap({ user: null, brands: [], workspaces: [], capabilities: {} }) }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])
  useEffect(() => { if (brandId) localStorage.setItem('sendry_brand', brandId) }, [brandId])
  useEffect(() => {
    if (!bootstrap.user) return
    setLocale(resolveLocale(bootstrap.user.language))
    const preferred = bootstrap.user.theme
    setTheme(preferred === 'light' || preferred === 'dark' ? preferred : 'system' as ThemePreference)
  }, [bootstrap.user, setLocale, setTheme])

  const value = useMemo<AuthContextValue>(() => ({
    user: bootstrap.user,
    brands: bootstrap.brands,
    workspaces: bootstrap.workspaces,
    brand: bootstrap.brands.find((brand) => brand.id === brandId) ?? null,
    loading,
    login: async (email, password, code) => {
      const result = await post<{ user?: User; requiresTwoFactor?: boolean }>('/api/auth/login', { email, password, code })
      if (!result.requiresTwoFactor) await refresh()
      return result
    },
    logout: async () => { await api('/api/auth/logout', { method: 'POST' }); setBootstrap({ user: null, brands: [], workspaces: [], capabilities: {} }) },
    selectBrand: setBrandId,
    refresh,
  }), [bootstrap, brandId, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}

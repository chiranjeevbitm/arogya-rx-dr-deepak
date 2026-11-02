import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { api } from './api'
import { clearCache } from '../components/ui'
import type { ClinicSettings } from '../../shared/settings'

export type Me = {
  user: { id: string; clinic_id: string; name: string; role: 'doctor' | 'reception' | 'admin'; phone: string }
  clinic: { id: string; slug: string; name: string; settings: ClinicSettings }
  features: { ai: boolean; ai_model: string; ai_providers?: string; voice?: boolean; stt?: 'murf' | 'server'; whatsapp_api: boolean; storage: 'supabase' | 'db' }
}
const Ctx = createContext<{ me: Me | null; loading: boolean; refresh: () => Promise<void>; setSettings: (s: ClinicSettings) => void }>({ me: null, loading: true, refresh: async () => {}, setSettings: () => {} })
export const useSession = () => useContext(Ctx)
export const useMe = () => useContext(Ctx).me!

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    try { setMe(await api<Me>('/auth/me')) } catch { setMe(null) } finally { setLoading(false) }
  }, [])
  useEffect(() => { refresh(); const f = () => { clearCache(); setMe(null) }; window.addEventListener('arx:logout', f); return () => window.removeEventListener('arx:logout', f) }, [refresh])
  return <Ctx.Provider value={{ me, loading, refresh, setSettings: s => setMe(m => (m ? { ...m, clinic: { ...m.clinic, settings: s } } : m)) }}>{children}</Ctx.Provider>
}

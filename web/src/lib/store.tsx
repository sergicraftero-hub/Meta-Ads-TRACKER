import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, qs, ApiError } from './api'
import { presetRange, type RangePreset } from '@shared/dates'
import type { AccountReport, AdAccount, DateRange, Me } from '@shared/types'

const ls = {
  get(k: string) {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* private mode */
    }
  }
}

export type ThemePref = 'system' | 'light' | 'dark'

interface Store {
  me: Me | null
  meLoaded: boolean
  setMe: (m: Me | null) => void
  refreshMe: () => Promise<void>
  updateMe: (patch: Partial<Pick<Me, 'name' | 'mode' | 'demo' | 'targets'>>) => Promise<void>
  accounts: AdAccount[]
  accountsError: ApiError | null
  reloadAccounts: (force?: boolean) => Promise<void>
  accountId: string
  setAccountId: (id: string) => void
  account: AdAccount | undefined
  preset: RangePreset | 'custom'
  range: DateRange
  setPreset: (p: RangePreset) => void
  setCustomRange: (r: DateRange) => void
  theme: ThemePref
  setTheme: (t: ThemePref) => void
  refreshNonce: number
  hardRefresh: () => void
}

const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [meLoaded, setMeLoaded] = useState(false)
  const [accounts, setAccounts] = useState<AdAccount[]>([])
  const [accountsError, setAccountsError] = useState<ApiError | null>(null)
  const [accountId, setAccountIdState] = useState(ls.get('ap.account') ?? '')
  const [preset, setPresetState] = useState<RangePreset | 'custom'>((ls.get('ap.preset') as RangePreset) || 'last_30d')
  const [range, setRange] = useState<DateRange>(() => presetRange(((ls.get('ap.preset') as RangePreset) || 'last_30d') as RangePreset))
  const [theme, setThemeState] = useState<ThemePref>((ls.get('ap.theme') as ThemePref) || 'system')
  const [refreshNonce, setNonce] = useState(0)

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const refreshMe = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/auth/me'))
    } catch {
      setMe(null)
    } finally {
      setMeLoaded(true)
    }
  }, [])
  useEffect(() => {
    refreshMe()
  }, [refreshMe])

  const updateMe = useCallback(async (patch: Partial<Pick<Me, 'name' | 'mode' | 'demo' | 'targets'>>) => {
    setMe(await api.patch<Me>('/auth/me', patch))
  }, [])

  const reloadAccounts = useCallback(async (force = false) => {
    setAccountsError(null)
    try {
      const list = await api.get<AdAccount[]>('/meta/accounts' + qs({ force: force ? 1 : undefined }))
      setAccounts(list)
      setAccountIdState((cur) => (list.some((a) => a.id === cur) ? cur : (list.find((a) => a.status === 1) ?? list[0])?.id ?? ''))
    } catch (e) {
      setAccounts([])
      setAccountsError(e as ApiError)
    }
  }, [])

  // Reload accounts whenever the data source changes (demo <-> live).
  const sourceKey = me ? `${me.id}|${me.demo}|${me.meta.connected}` : ''
  useEffect(() => {
    if (sourceKey) reloadAccounts()
  }, [sourceKey, reloadAccounts])

  const setAccountId = useCallback((id: string) => {
    setAccountIdState(id)
    ls.set('ap.account', id)
  }, [])
  const setPreset = useCallback((p: RangePreset) => {
    setPresetState(p)
    setRange(presetRange(p))
    ls.set('ap.preset', p)
  }, [])
  const setCustomRange = useCallback((r: DateRange) => {
    setPresetState('custom')
    setRange(r)
  }, [])
  const setTheme = useCallback((t: ThemePref) => {
    setThemeState(t)
    ls.set('ap.theme', t)
  }, [])
  const hardRefresh = useCallback(() => setNonce((n) => n + 1), [])

  const value = useMemo<Store>(
    () => ({
      me,
      meLoaded,
      setMe,
      refreshMe,
      updateMe,
      accounts,
      accountsError,
      reloadAccounts,
      accountId,
      setAccountId,
      account: accounts.find((a) => a.id === accountId),
      preset,
      range,
      setPreset,
      setCustomRange,
      theme,
      setTheme,
      refreshNonce,
      hardRefresh
    }),
    [me, meLoaded, refreshMe, updateMe, accounts, accountsError, reloadAccounts, accountId, setAccountId, preset, range, setPreset, setCustomRange, theme, setTheme, refreshNonce, hardRefresh]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('StoreProvider missing')
  return s
}

// ---------- data hooks ----------

const reportCache = new Map<string, { at: number; data: AccountReport }>()
const CLIENT_TTL = 5 * 60_000

export interface AsyncState<T> {
  data: T | null
  error: ApiError | null
  loading: boolean
}

/** Generic fetch hook keyed by a string; refetches when key changes, ignores stale responses. */
export function useApi<T>(key: string | null, fetcher: () => Promise<T>, cache?: Map<string, { at: number; data: T }>): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: Boolean(key) })
  const [n, setN] = useState(0)
  const latest = useRef(0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  useEffect(() => {
    if (!key) {
      setState({ data: null, error: null, loading: false })
      return
    }
    const hit = cache?.get(key)
    if (hit && Date.now() - hit.at < CLIENT_TTL && n === 0) {
      setState({ data: hit.data, error: null, loading: false })
      return
    }
    const id = ++latest.current
    setState((s) => ({ data: s.data, error: null, loading: true }))
    fetcherRef
      .current()
      .then((data) => {
        if (id !== latest.current) return
        cache?.set(key, { at: Date.now(), data })
        setState({ data, error: null, loading: false })
      })
      .catch((error: ApiError) => {
        if (id === latest.current) setState({ data: null, error, loading: false })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, n])
  return { ...state, reload: () => setN((x) => x + 1) }
}

export function useReport() {
  const { accountId, range, me, refreshNonce } = useStore()
  const key = accountId && me ? `${me.demo}|${accountId}|${range.since}|${range.until}|${refreshNonce}` : null
  return useApi<AccountReport>(
    key,
    () => api.get<AccountReport>('/meta/report' + qs({ accountId, since: range.since, until: range.until, force: refreshNonce > 0 ? 1 : undefined })),
    reportCache
  )
}

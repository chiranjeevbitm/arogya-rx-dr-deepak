import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import Icon from './Icon'

type Toast = { id: number; text: string; kind?: 'ok' | 'err' | 'info' }
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'err' | 'info') => void>(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastHost({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([])
  const push = useCallback((text: string, kind?: 'ok' | 'err' | 'info') => {
    const id = Date.now() + Math.random()
    setList(l => [...l.slice(-2), { id, text, kind }])
    setTimeout(() => setList(l => l.filter(t => t.id !== id)), kind === 'err' ? 6500 : 3500)
  }, [])
  return <ToastCtx.Provider value={push}><DialogHost>{children}</DialogHost><div className="toasts" role="status" aria-live="polite">{list.map(t => <div key={t.id} className={'toast ' + (t.kind || '')}>{t.text}</div>)}</div></ToastCtx.Provider>
}

export function Modal({ title, onClose, children, footer, width }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose); close.current = onClose   // parents pass a new onClose on every render: keep it out of the effect deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current() }
    document.addEventListener('keydown', k)
    // focus the first field once, when the dialog opens (not on every keystroke)
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.icon-btn)')
    first?.focus()
    return () => document.removeEventListener('keydown', k)
  }, [])
  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div ref={ref} className="sheet" role="dialog" aria-modal="true" style={{ ['--w' as any]: (width || 560) + 'px' }}>
      <div className="sheet-h"><h2 className="grow">{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon n="x" /></button></div>
      <div className="sheet-b">{children}</div>
      {footer && <div className="sheet-f">{footer}</div>}
    </div>
  </div>
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small className="faint">{hint}</small>}</label>
}

export function TagInput({ value, onChange, placeholder, suggestions = [] }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[] }) {
  const [t, setT] = useState('')
  const add = (s: string) => { const x = s.trim(); if (x && !value.some(v => v.toLowerCase() === x.toLowerCase())) onChange([...value, x]); setT('') }
  return <div className="stack tight">
    <div className="chips">
      {value.map(v => <button type="button" key={v} className="chip on" onClick={() => onChange(value.filter(x => x !== v))}>{v} <span className="x" aria-label={`Remove ${v}`}>×</span></button>)}
      <input className="inp sm" style={{ width: 'auto', flex: '1 1 160px' }} value={t} placeholder={placeholder} onChange={e => setT(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(t) } else if (e.key === 'Backspace' && !t && value.length) onChange(value.slice(0, -1)) }} onBlur={() => t && add(t)} />
    </div>
    {suggestions.length > 0 && <div className="chips">{suggestions.filter(s => !value.includes(s)).slice(0, 24).map(s => <button type="button" key={s} className="chip" onClick={() => add(s)}>+ {s}</button>)}</div>}
  </div>
}

export function Spinner({ label = 'Loading…' }: { label?: string }) { return <div className="empty">{label}</div> }

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, set] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true })
  const [n, setN] = useState(0)
  useEffect(() => {
    let alive = true
    set(s => ({ ...s, loading: true }))
    fn().then(d => alive && set({ data: d, loading: false })).catch(e => alive && set({ error: e.message, loading: false }))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n])
  return { ...state, reload: () => setN(x => x + 1), setData: (d: T) => set(s => ({ ...s, data: d })) }
}

/** Calls `fn` every `ms` while the tab is visible, and straight away when the tab is focused or the network returns. */
export function useLive(fn: () => void, ms: number) {
  const ref = useRef(fn); ref.current = fn
  useEffect(() => {
    const go = () => { if (document.visibilityState === 'visible') ref.current() }
    const t = setInterval(go, ms)
    document.addEventListener('visibilitychange', go); window.addEventListener('focus', go); window.addEventListener('online', go)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', go); window.removeEventListener('focus', go); window.removeEventListener('online', go) }
  }, [ms])
}

/** In-app replacements for the browser's confirm()/prompt(): they never block the page and look like the rest of the app. */
type DlgReq = { kind: 'confirm' | 'prompt'; title: string; text?: string; value?: string; ok: string; danger?: boolean; alt?: string; res: (v: any) => void }
const DlgCtx = createContext<{ ask: (title: string, o?: { text?: string; ok?: string; danger?: boolean; alt?: string }) => Promise<'ok' | 'alt' | null>; prompt: (title: string, o?: { text?: string; value?: string; ok?: string }) => Promise<string | null> }>({ ask: async () => null, prompt: async () => null })
export const useDialog = () => useContext(DlgCtx)
export function DialogHost({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<DlgReq | null>(null), [val, setVal] = useState('')
  const api = useRef({
    ask: (title: string, o: { text?: string; ok?: string; danger?: boolean; alt?: string } = {}) => new Promise<'ok' | 'alt' | null>(res => setReq({ kind: 'confirm', title, text: o.text, ok: o.ok || 'OK', danger: o.danger, alt: o.alt, res })),
    prompt: (title: string, o: { text?: string; value?: string; ok?: string } = {}) => new Promise<string | null>(res => { setVal(o.value || ''); setReq({ kind: 'prompt', title, text: o.text, value: o.value, ok: o.ok || 'Save', res }) }),
  })
  const done = (v: any) => { req?.res(v); setReq(null) }
  return <DlgCtx.Provider value={api.current}>{children}
    {req && <Modal title={req.title} width={460} onClose={() => done(null)} footer={<>
      <button className="btn" onClick={() => done(null)}>Cancel</button>
      {req.alt && <button className="btn" onClick={() => done('alt')}>{req.alt}</button>}
      <button className={'btn ' + (req.danger ? 'danger' : 'primary')} disabled={req.kind === 'prompt' && val.trim().length < 2} onClick={() => done(req.kind === 'prompt' ? val.trim() : 'ok')}>{req.ok}</button></>}>
      {req.text && <p style={{ margin: '0 0 10px' }}>{req.text}</p>}
      {req.kind === 'prompt' && <input className="inp" value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && val.trim().length >= 2) done(val.trim()) }} />}
    </Modal>}
  </DlgCtx.Provider>
}

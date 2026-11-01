import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { inr } from '../lib/format'
import { detectForm, defaultDose, defaultRoute, type Med } from '../../shared/rx'

type Hit = { name: string; kind: 'ja' | 'brand' | 'custom'; form?: string; category?: string; manufacturer?: string; pack?: string; price?: number | null; favourite?: boolean; uses?: number; defaults?: Partial<Med> }

export function medFromHit(h: { name: string; kind?: string; form?: string; price?: number | null; defaults?: Partial<Med> }): Med {
  const form = h.defaults?.form || h.form || detectForm(h.name)
  return {
    name: h.name, kind: (h.defaults?.kind || h.kind || 'brand') as Med['kind'], form,
    dose: h.defaults?.dose || defaultDose(form), route: h.defaults?.route || defaultRoute(form),
    freq: h.defaults?.freq || (form === 'INH' ? 'SOS' : form === 'SYP' ? '1-1-1' : '1-0-1'),
    timing: h.defaults?.timing ?? (['TAB', 'CAP', 'SYP', 'SUSP', 'SACHET'].includes(form) ? 'after' : ''),
    days: h.defaults?.days ?? 5, price: h.price ?? null, instructions: '',
  }
}

export default function MedSearch({ onPick, autoFocus }: { onPick: (m: Med) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState(''), [hits, setHits] = useState<Hit[]>([]), [open, setOpen] = useState(false), [hl, setHl] = useState(0)
  const box = useRef<HTMLDivElement>(null), inp = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    const ac = new AbortController()
    const t = setTimeout(() => api<Hit[]>('/medicines?q=' + encodeURIComponent(q.trim()), { signal: ac.signal }).then(h => { setHits(h); setHl(0) }).catch(() => {}), q ? 140 : 0)
    return () => { clearTimeout(t); ac.abort() }
  }, [q, open])
  useEffect(() => { const f = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f) }, [])
  const pick = (h: Hit | null) => {
    if (h) onPick(medFromHit(h))
    else if (q.trim().length >= 2) { onPick(medFromHit({ name: q.trim(), kind: 'custom' })); api('/medicines/custom', { body: { name: q.trim() } }).catch(() => {}) }
    setQ(''); setHits([]); setOpen(false); inp.current?.focus()
  }
  const opts = q.trim().length >= 2 ? [...hits, null] : hits
  return <div className="ac" ref={box}>
    <input ref={inp} className="inp" autoFocus={autoFocus} placeholder="Add medicine: type a brand or generic name (e.g. dolo, metformin 500)" value={q}
      onClick={() => setOpen(true)} onChange={e => { setQ(e.target.value); setOpen(true) }}
      onKeyDown={e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setHl(h => Math.min(h + 1, opts.length - 1)) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setHl(h => Math.max(h - 1, 0)) }
        else if (e.key === 'Enter') { e.preventDefault(); if (opts.length) pick(opts[hl] ?? null) }
        else if (e.key === 'Escape') setOpen(false)
      }} role="combobox" aria-expanded={open} aria-autocomplete="list" />
    {open && opts.length > 0 && <div className="ac-list" role="listbox">
      {!q && <div className="tiny muted" style={{ padding: '6px 12px' }}>Your most used medicines</div>}
      {opts.map((h, i) => h ? <button type="button" key={h.name + i} className={'ac-item' + (i === hl ? ' hl' : '')} onMouseEnter={() => setHl(i)} onClick={() => pick(h)} role="option" aria-selected={i === hl}>
        <span className="grow"><span className="nm">{h.name}</span><br /><span className="meta">{h.favourite ? `Your usual: ${[h.defaults?.dose, h.defaults?.freq, h.defaults?.days ? h.defaults.days + ' days' : ''].filter(Boolean).join(', ')}` : [h.manufacturer, h.category, h.pack].filter(Boolean).join(', ')}</span></span>
        {h.favourite ? <span className="tag ink">Used {h.uses}×</span> : h.kind === 'ja' ? <span className="tag green">Jan Aushadhi{h.price ? ' ' + inr(h.price) : ''}</span> : h.kind === 'custom' ? <span className="tag">Added by you</span> : null}
      </button> : <button type="button" key="custom" className={'ac-item' + (i === hl ? ' hl' : '')} onMouseEnter={() => setHl(i)} onClick={() => pick(null)}>
        <span className="grow"><span className="nm">Add “{q.trim()}” as typed</span><br /><span className="meta">Not in the list. It will be saved for next time.</span></span>
      </button>)}
    </div>}
  </div>
}

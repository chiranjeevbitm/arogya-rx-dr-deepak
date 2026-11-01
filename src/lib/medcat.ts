// The medicine catalogue (about 9,900 names, 190 KB compressed) is searched inside the browser:
// results appear instantly with no network call per keystroke, and still work on a slow connection.
export type CatRow = { name: string; kind: 'ja' | 'brand' | 'custom'; category?: string; manufacturer?: string; pack?: string; price?: number | null; form?: string; low: string }

let cat: Promise<CatRow[]> | null = null
async function part(i: number): Promise<any[]> {
  const r = await fetch(`/seed/medicines-0${i}.json.gz`)
  if (!r.ok) throw new Error('catalogue')
  const buf = new Uint8Array(await r.arrayBuffer())
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    if (!('DecompressionStream' in window)) throw new Error('no gzip')
    const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
    return JSON.parse(await new Response(s).text())
  }
  return JSON.parse(new TextDecoder().decode(buf))   // already decompressed by the server
}
export function loadCatalogue(): Promise<CatRow[]> {
  if (!cat) cat = Promise.all([part(0), part(1)]).then(ps => ps.flat().map((r: any) => ({ name: r[0], kind: r[1], category: r[2], manufacturer: r[3], pack: r[4], price: r[5], form: r[6], low: String(r[0]).toLowerCase() }))).catch(e => { cat = null; throw e })
  return cat
}

/** Prefix matches first, then word-start matches, then anywhere. Jan Aushadhi generics rank above brands. */
export function searchCatalogue(rows: CatRow[], extra: CatRow[], query: string, limit = 20): CatRow[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (q.length < 2) return []
  const toks = q.split(' ')
  const out: { r: CatRow; s: number }[] = []
  const scan = (list: CatRow[], bonus: number) => {
    for (const r of list) {
      const n = r.low
      let s = -1
      if (n.startsWith(q)) s = 0
      else if (toks.every(t => n.startsWith(t) || n.includes(' ' + t))) s = 1
      else if (toks.every(t => n.includes(t))) s = 2
      if (s < 0) continue
      out.push({ r, s: s * 10 + (r.kind === 'ja' ? 0 : 3) + bonus + Math.min(n.length / 40, 2) })
    }
  }
  scan(extra, -5); scan(rows, 0)
  out.sort((a, b) => a.s - b.s)
  return out.slice(0, limit).map(x => x.r)
}

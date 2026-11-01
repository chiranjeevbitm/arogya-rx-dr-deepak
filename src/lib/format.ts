export { fmtDate, istToday, addDaysISO } from '../../shared/rx'
export const inr = (n: number | null | undefined) => '₹' + Math.round(Number(n || 0)).toLocaleString('en-IN')
export const ageSex = (p: { age_years?: number | null; sex?: string | null }) => [p.age_years != null ? `${p.age_years} y` : '', p.sex === 'M' ? 'Male' : p.sex === 'F' ? 'Female' : p.sex === 'O' ? 'Other' : ''].filter(Boolean).join(', ')
export const dayName = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
export const timeAgo = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
export const d10 = (v: any) => (v instanceof Date ? v.toISOString() : String(v || '')).slice(0, 10)

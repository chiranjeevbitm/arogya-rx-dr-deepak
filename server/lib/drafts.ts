import type postgres from 'postgres'
import { unchangedDraftIds, type RxRow } from '../../shared/drafts.js'

/** Everything `unchangedDraftIds` needs for each prescription, with the visit's own complaint and vitals. */
export const rxRowsFor = (db: postgres.Sql | postgres.TransactionSql, patientIds: string[]) => db<(RxRow & { patient_id: string; clinic_id: string; updated_at: Date; visit_id: string | null; rx_date: string })[]>`
  select x.id, x.clinic_id, x.patient_id, x.visit_id, x.rx_date::text as rx_date, x.status, x.finalized_at, x.created_at, x.updated_at, x.data, x.meds,
         v.complaint as visit_complaint, v.vitals as visit_vitals
    from arx.prescriptions x left join arx.visits v on v.id = x.visit_id
   where x.patient_id = any(${patientIds}::uuid[])`

/** Deletes drafts that say nothing new (see shared/drafts.ts) and that nobody has touched for `idleMinutes`,
    so a draft open on a screen right now is never pulled away. Returns how many went, per clinic. */
export async function pruneUnchangedDrafts(db: postgres.Sql, opts: { clinicId?: string; idleMinutes?: number } = {}) {
  const idle = opts.idleMinutes ?? 120
  const pts = await db<{ patient_id: string }[]>`select distinct patient_id from arx.prescriptions
    where status = 'draft' and finalized_at is null and updated_at < now() - make_interval(mins => ${idle})
      ${opts.clinicId ? db`and clinic_id = ${opts.clinicId}` : db``}`
  const byClinic: Record<string, number> = {}
  let removed = 0
  for (let i = 0; i < pts.length; i += 200) {
    const rows = await rxRowsFor(db, pts.slice(i, i + 200).map(p => p.patient_id))
    const per = new Map<string, (typeof rows)[number][]>()
    for (const r of rows) { if (!per.has(r.patient_id)) per.set(r.patient_id, []); per.get(r.patient_id)!.push(r) }
    const cutoff = Date.now() - idle * 60_000
    const gone: { id: string }[] = []
    for (const list of per.values()) {
      const ids = unchangedDraftIds(list)
      for (const r of list) if (ids.has(r.id) && new Date(r.updated_at).getTime() < cutoff) gone.push(r)
    }
    if (!gone.length) continue
    // the status check is repeated in the delete: a draft finalised or edited a moment ago stays
    const del = await db<{ clinic_id: string }[]>`delete from arx.prescriptions where id = any(${gone.map(g => g.id)}::uuid[])
      and status = 'draft' and finalized_at is null and updated_at < now() - make_interval(mins => ${idle}) returning clinic_id`
    for (const d of del) byClinic[d.clinic_id] = (byClinic[d.clinic_id] || 0) + 1
    removed += del.length
  }
  for (const [clinicId, n] of Object.entries(byClinic))
    await db`insert into arx.audit_log (clinic_id, action, entity, entity_id, meta) values (${clinicId}, 'rx.prune_drafts', 'clinic', ${clinicId}, ${db.json({ removed: n })})`
  return { removed }
}

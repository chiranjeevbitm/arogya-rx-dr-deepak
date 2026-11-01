/* Database migrations. Applied in order by ensureSchema() with an advisory lock.
   Everything lives in the private `arx` schema, which Supabase's Data API does not expose.
   RLS is enabled on every table as defence in depth: anon/authenticated get nothing,
   and only the role the server connects as has a policy. Tenant isolation is enforced
   in every query by clinic_id. */

export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'init',
    sql: /* sql */ `
create schema if not exists arx;
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create table arx.clinics (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name        text not null,
  settings    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create table arx.users (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references arx.clinics(id) on delete cascade,
  name            text not null,
  phone           text not null unique check (phone ~ '^[0-9]{10}$'),
  email           text,
  password_hash   text not null,
  role            text not null check (role in ('doctor','reception','admin')),
  active          boolean not null default true,
  session_version integer not null default 1,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now()
);
create index users_clinic_idx on arx.users (clinic_id);

create table arx.patients (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references arx.clinics(id) on delete cascade,
  uhid        text not null,
  name        text not null,
  sex         text check (sex in ('M','F','O')),
  age_years   integer check (age_years between 0 and 125),
  dob         date,
  phone       text,
  address     text,
  allergies   text[] not null default '{}',
  conditions  text[] not null default '{}',
  notes       text,
  legacy_key  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (clinic_id, uhid)
);
create index patients_phone_idx on arx.patients (clinic_id, phone);
create index patients_name_trgm on arx.patients using gin (lower(name) extensions.gin_trgm_ops);
create unique index patients_legacy_idx on arx.patients (clinic_id, legacy_key) where legacy_key is not null;
create index patients_recent_idx on arx.patients (clinic_id, updated_at desc);

create table arx.appointments (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references arx.clinics(id) on delete cascade,
  patient_id  uuid references arx.patients(id) on delete set null,
  name        text not null,
  phone       text not null,
  age_years   integer,
  sex         text,
  appt_date   date not null,
  appt_time   time,
  session     text,
  reason      text,
  source      text not null default 'phone' check (source in ('online','phone','walk_in','whatsapp','follow_up')),
  status      text not null default 'booked' check (status in ('booked','arrived','cancelled','no_show')),
  visit_id    uuid,
  created_by  uuid references arx.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index appointments_day_idx on arx.appointments (clinic_id, appt_date, appt_time);
create index appointments_patient_idx on arx.appointments (patient_id);

create table arx.visits (
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null references arx.clinics(id) on delete cascade,
  patient_id     uuid not null references arx.patients(id) on delete cascade,
  visit_date     date not null,
  token          integer not null,
  status         text not null default 'waiting' check (status in ('waiting','with_doctor','done','cancelled')),
  visit_type     text not null default 'new' check (visit_type in ('new','follow_up','review')),
  source         text not null default 'walk_in',
  complaint      text,
  vitals         jsonb not null default '{}',
  appointment_id uuid references arx.appointments(id) on delete set null,
  arrived_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  created_by     uuid references arx.users(id) on delete set null,
  unique (clinic_id, visit_date, token)
);
create index visits_patient_idx on arx.visits (patient_id);
create index visits_day_idx on arx.visits (clinic_id, visit_date, status);

create table arx.files (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references arx.clinics(id) on delete cascade,
  kind        text not null check (kind in ('rx_pdf','scan','receipt_pdf','logo','signature','other')),
  storage     text not null check (storage in ('supabase','db')),
  path        text not null,
  mime        text not null,
  size        integer not null,
  data        bytea,
  created_by  uuid references arx.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index files_clinic_idx on arx.files (clinic_id, created_at desc);

create table arx.prescriptions (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references arx.clinics(id) on delete cascade,
  patient_id   uuid not null references arx.patients(id) on delete cascade,
  visit_id     uuid references arx.visits(id) on delete set null,
  status       text not null default 'draft' check (status in ('draft','final')),
  rx_date      date not null,
  data         jsonb not null default '{}',
  meds         jsonb not null default '[]',
  pdf_file_id  uuid references arx.files(id) on delete set null,
  created_by   uuid references arx.users(id) on delete set null,
  finalized_at timestamptz,
  legacy_id    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index rx_patient_idx on arx.prescriptions (clinic_id, patient_id, rx_date desc);
create index rx_day_idx on arx.prescriptions (clinic_id, rx_date desc);
create index rx_visit_idx on arx.prescriptions (visit_id);
create unique index rx_legacy_idx on arx.prescriptions (clinic_id, legacy_id) where legacy_id is not null;

create table arx.documents (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references arx.clinics(id) on delete cascade,
  patient_id  uuid not null references arx.patients(id) on delete cascade,
  file_id     uuid references arx.files(id) on delete set null,
  kind        text not null check (kind in ('old_rx','lab_report','other')),
  doc_date    date,
  extracted   jsonb not null default '{}',
  created_by  uuid references arx.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index documents_patient_idx on arx.documents (clinic_id, patient_id, created_at desc);

create table arx.lab_results (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references arx.clinics(id) on delete cascade,
  patient_id  uuid not null references arx.patients(id) on delete cascade,
  test        text not null,
  value_num   numeric,
  value_text  text,
  unit        text,
  flag        text check (flag in ('low','high','normal','abnormal')),
  result_date date not null,
  source      text not null default 'manual' check (source in ('manual','scan','rx')),
  document_id uuid references arx.documents(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index labs_patient_idx on arx.lab_results (clinic_id, patient_id, test, result_date);

create table arx.templates (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references arx.clinics(id) on delete cascade,
  name        text not null,
  data        jsonb not null default '{}',
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);
create index templates_clinic_idx on arx.templates (clinic_id, sort);

create table arx.bills (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references arx.clinics(id) on delete cascade,
  bill_no     integer not null,
  patient_id  uuid references arx.patients(id) on delete set null,
  visit_id    uuid references arx.visits(id) on delete set null,
  items       jsonb not null default '[]',
  total       numeric(10,2) not null check (total >= 0),
  discount    numeric(10,2) not null default 0 check (discount >= 0),
  paid        numeric(10,2) not null default 0 check (paid >= 0),
  mode        text not null check (mode in ('cash','upi','card','free','due')),
  status      text not null default 'paid' check (status in ('paid','due','void')),
  note        text,
  bill_date   date not null,
  created_by  uuid references arx.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  voided_at   timestamptz,
  void_reason text,
  unique (clinic_id, bill_no)
);
create index bills_day_idx on arx.bills (clinic_id, bill_date);
create index bills_patient_idx on arx.bills (patient_id);

create table arx.messages (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references arx.clinics(id) on delete cascade,
  patient_id      uuid references arx.patients(id) on delete set null,
  prescription_id uuid references arx.prescriptions(id) on delete set null,
  kind            text not null check (kind in ('rx','reminder','booking','receipt','other')),
  channel         text not null check (channel in ('api','link')),
  to_phone        text not null,
  status          text not null check (status in ('queued','sent','failed','link_opened')),
  provider_ref    text,
  error           text,
  created_by      uuid references arx.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index messages_clinic_idx on arx.messages (clinic_id, created_at desc);

create table arx.medicines (
  id           bigint generated always as identity primary key,
  name         text not null,
  kind         text not null check (kind in ('ja','brand','custom')),
  category     text,
  manufacturer text,
  pack         text,
  price        numeric(10,2),
  form         text,
  clinic_id    uuid references arx.clinics(id) on delete cascade
);
create index medicines_name_trgm on arx.medicines using gin (lower(name) extensions.gin_trgm_ops);
create index medicines_prefix_idx on arx.medicines (lower(name) text_pattern_ops);

create table arx.med_usage (
  clinic_id  uuid not null references arx.clinics(id) on delete cascade,
  name       text not null,
  uses       integer not null default 0,
  last_used  timestamptz not null default now(),
  defaults   jsonb not null default '{}',
  primary key (clinic_id, name)
);

create table arx.counters (
  clinic_id uuid not null references arx.clinics(id) on delete cascade,
  name      text not null,
  value     bigint not null default 0,
  primary key (clinic_id, name)
);

create table arx.audit_log (
  id         bigint generated always as identity primary key,
  clinic_id  uuid,
  user_id    uuid,
  action     text not null,
  entity     text,
  entity_id  text,
  meta       jsonb not null default '{}',
  ip         text,
  at         timestamptz not null default now()
);
create index audit_clinic_idx on arx.audit_log (clinic_id, at desc);

create or replace function arx.audit_log_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_update before update or delete on arx.audit_log
  for each row execute function arx.audit_log_append_only();

create table arx.rate_limits (
  key       text primary key,
  count     integer not null,
  reset_at  timestamptz not null
);

create table arx.ai_usage (
  id            bigint generated always as identity primary key,
  clinic_id     uuid,
  user_id       uuid,
  kind          text not null,
  provider      text,
  model         text,
  input_tokens  integer,
  output_tokens integer,
  ms            integer,
  ok            boolean not null,
  error         text,
  created_at    timestamptz not null default now()
);
`,
  },
  {
    version: 2,
    name: 'lockdown',
    sql: /* sql */ `
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'arx' loop
    execute format('alter table arx.%I enable row level security', t.tablename);
    execute format('drop policy if exists server_all on arx.%I', t.tablename);
    execute format('create policy server_all on arx.%I to current_user using (true) with check (true)', t.tablename);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema arx from anon, authenticated';
    execute 'revoke all on all tables in schema arx from anon, authenticated';
    execute 'alter default privileges in schema arx revoke all on tables from anon, authenticated';
  end if;
end $$;
`,
  },
]

-- =====================================================================
-- SAA Comfort Air LLC — Supabase schema
-- Covers: customers, jobs, quotes, invoices, payments, membership plans,
-- and the material/cost catalog behind the quoting app.
-- Run this once in the Supabase SQL editor (or via migration) on a new
-- project. Safe to re-run individual CREATE TABLE blocks is NOT
-- guaranteed — this is a fresh-project script, not an idempotent migration.
-- =====================================================================

create extension if not exists pgcrypto;

-- ============================================================
-- CORE ENTITIES
-- ============================================================

create table customers (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text,
  company_name text,
  phone text,
  email text,
  billing_address text,
  billing_city text,
  billing_state text default 'TX',
  billing_zip text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table technicians (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null check (role in ('technician','lead','admin')),
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- MEMBERSHIP PLANS
-- ============================================================

create table membership_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  visits_per_year integer not null default 1,
  price_per_year numeric(10,2) not null,
  features jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table customer_memberships (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  plan_id uuid not null references membership_plans(id),
  start_date date not null default current_date,
  end_date date,
  status text not null default 'active' check (status in ('active','cancelled','expired')),
  visits_used integer not null default 0,
  auto_renew boolean not null default true,
  created_at timestamptz not null default now()
);
create index on customer_memberships (customer_id);
create index on customer_memberships (plan_id);

-- ============================================================
-- MATERIAL / COST CATALOG (ported from assets/js/pricing-data.js)
-- ============================================================

create table material_catalog (
  id uuid primary key default gen_random_uuid(),
  worksheet text not null,          -- condenser_change / coil_change / furnace_change / plenum_change / drainline_maintenance / labor
  item_group text,                  -- MATERIALS / ACCESSORIES
  category text,                    -- Refrigeration, Electrical, Equipment, etc.
  item_name text not null,
  unit text,
  default_qty numeric(10,2) default 1,
  low_unit_cost numeric(10,2) not null default 0,
  high_unit_cost numeric(10,2) not null default 0,
  spec text,
  notes text,
  optional_flag text,               -- Yes / Check / Optional
  active boolean not null default true,
  sort_order integer default 0,
  updated_at timestamptz not null default now()
);
create index on material_catalog (worksheet);

create table equipment_tonnage_pricing (
  id uuid primary key default gen_random_uuid(),
  equipment_type text not null check (equipment_type in ('condenser','coil')),
  tonnage numeric(3,1) not null,
  description text,
  low_price numeric(10,2) not null,
  high_price numeric(10,2) not null,
  unique (equipment_type, tonnage)
);

create table furnace_tiers (
  id uuid primary key default gen_random_uuid(),
  tier_key text unique not null,
  label text not null,
  low_price numeric(10,2) not null,
  high_price numeric(10,2) not null
);

create table install_zones (
  id smallint primary key,
  label text not null,
  multiplier numeric(4,2) not null default 1.0,
  note text
);

-- ============================================================
-- JOBS
-- ============================================================

create table jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete restrict,
  job_type text not null check (job_type in (
    'new_install','replacement','condenser_change','coil_change','furnace_change',
    'plenum_change','drainline_maintenance','duct_cleaning','inspection',
    'maintenance_visit','custom'
  )),
  status text not null default 'lead' check (status in (
    'lead','quoted','scheduled','in_progress','completed','cancelled'
  )),
  job_address text,
  job_city text,
  job_state text default 'TX',
  job_zip text,
  assigned_technician_id uuid references technicians(id),
  scheduled_date date,
  completed_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on jobs (customer_id);
create index on jobs (status);

-- ============================================================
-- QUOTES
-- ============================================================

create table quotes (
  id uuid primary key default gen_random_uuid(),
  quote_number text unique,
  job_id uuid references jobs(id) on delete set null,
  customer_id uuid not null references customers(id) on delete restrict,
  quote_type text not null,
  status text not null default 'draft' check (status in ('draft','sent','accepted','declined','expired')),
  zone_id smallint references install_zones(id),
  overhead_pct numeric(5,2) not null default 0,
  subtotal_low numeric(10,2) default 0,
  subtotal_high numeric(10,2) default 0,
  total_low numeric(10,2) default 0,
  total_high numeric(10,2) default 0,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on quotes (customer_id);
create index on quotes (job_id);

create table quote_line_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  material_catalog_id uuid references material_catalog(id),
  description text not null,
  category text,
  unit text,
  qty numeric(10,2) not null default 1,
  low_unit_cost numeric(10,2) not null default 0,
  high_unit_cost numeric(10,2) not null default 0,
  low_ext numeric(10,2) generated always as (qty * low_unit_cost) stored,
  high_ext numeric(10,2) generated always as (qty * high_unit_cost) stored,
  included boolean not null default true,
  sort_order integer default 0
);
create index on quote_line_items (quote_id);

-- ============================================================
-- JOB COSTING — actual materials used vs. what was quoted
-- ============================================================

create table job_materials (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  material_catalog_id uuid references material_catalog(id),
  description text not null,
  qty numeric(10,2) not null default 1,
  actual_unit_cost numeric(10,2) not null default 0,
  actual_ext_cost numeric(10,2) generated always as (qty * actual_unit_cost) stored,
  notes text,
  created_at timestamptz not null default now()
);
create index on job_materials (job_id);

-- ============================================================
-- INVOICES & PAYMENTS
-- ============================================================

create table invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text unique,
  job_id uuid references jobs(id) on delete set null,
  quote_id uuid references quotes(id) on delete set null,
  customer_id uuid not null references customers(id) on delete restrict,
  issue_date date not null default current_date,
  due_date date,
  amount_total numeric(10,2) not null default 0,
  status text not null default 'draft' check (status in ('draft','sent','partial','paid','overdue','void')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on invoices (customer_id);
create index on invoices (job_id);

create table invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  description text not null,
  qty numeric(10,2) not null default 1,
  unit_cost numeric(10,2) not null default 0,
  amount numeric(10,2) generated always as (qty * unit_cost) stored,
  sort_order integer default 0
);
create index on invoice_line_items (invoice_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete restrict,
  amount numeric(10,2) not null,
  payment_date date not null default current_date,
  method text check (method in ('cash','check','card','ach','financing','other')),
  reference_number text,
  notes text,
  created_at timestamptz not null default now()
);
create index on payments (invoice_id);
create index on payments (customer_id);

-- ============================================================
-- HELPER VIEW
-- ============================================================

create view invoice_balances as
select
  i.id as invoice_id,
  i.amount_total,
  coalesce(sum(p.amount), 0) as amount_paid,
  i.amount_total - coalesce(sum(p.amount), 0) as balance_due
from invoices i
left join payments p on p.invoice_id = i.id
group by i.id, i.amount_total;

-- ============================================================
-- ROW LEVEL SECURITY — locked down by default.
-- No policies are created here on purpose: until you decide how this
-- data should be accessed (staff-only via Supabase Auth, a backend API,
-- etc.), nothing is readable/writable except via the service role key.
-- ============================================================

alter table customers enable row level security;
alter table technicians enable row level security;
alter table membership_plans enable row level security;
alter table customer_memberships enable row level security;
alter table material_catalog enable row level security;
alter table equipment_tonnage_pricing enable row level security;
alter table furnace_tiers enable row level security;
alter table install_zones enable row level security;
alter table jobs enable row level security;
alter table quotes enable row level security;
alter table quote_line_items enable row level security;
alter table job_materials enable row level security;
alter table invoices enable row level security;
alter table invoice_line_items enable row level security;
alter table payments enable row level security;

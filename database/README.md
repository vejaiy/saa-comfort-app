# Supabase database

This schema and seed data are **live** in a Supabase project (created under
vejaiy@gmail.com's account, region us-west-2).

## What's set up

- `schema.sql` — every table (customers, technicians, membership plans,
  jobs, quotes, quote line items, job materials, invoices, invoice line
  items, payments) plus the material/cost catalog and pricing lookup
  tables (`material_catalog`, `equipment_tonnage_pricing`, `furnace_tiers`,
  `install_zones`), and the `invoice_balances` view.
- `seed.sql` — all pricing/material data ported 1:1 from
  `assets/js/pricing-data.js` (zones, tonnage pricing, furnace tiers,
  membership plans, and every material line for Condenser Change, Coil
  Change, Furnace Change, Plenum Change, Drainline Maintenance, and Labor).
  Applied and verified — row counts match the source data exactly.

## Security posture

**Row Level Security is enabled on every table, with zero policies
defined.** That's deliberate, not an oversight: right now nothing in
this app does real user authentication (the Employee section is a
client-side password screen only — see `assets/js/auth.js`), so no
browser-side key should be trusted with direct table access yet. As it
stands, only the Supabase service role key (server-side only, never
exposed to a browser) can read or write this data.

The `invoice_balances` view is created `with (security_invoker = true)`
so it always respects the querying user's RLS, not the view creator's.

## Before the website talks to this database

This still needs an access-model decision:
- Real staff login (e.g. Supabase Auth) so RLS policies can be written
  per-role, instead of the current password-only gate, **or**
- A small backend/API layer that holds the service role key and the
  site only ever calls that backend — never Supabase directly from the
  browser.

Wiring `pricing-data.js` to read from `material_catalog` instead of its
hardcoded arrays is a natural next step, but should wait until the
access model above is decided.

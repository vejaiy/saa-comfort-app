# SAA Comfort Air LLC — Website & Quoting App

A plain HTML/CSS/JavaScript website: a public marketing site plus a
login-gated Employee section with live pricing worksheets that mirror
`System_Replacement_Material_Cost.xlsx`, backed by a real Supabase
database. No build step, no server required — double-click any `.html`
file to open it, or host the folder anywhere that serves static files.

## Structure

```
index.html, about.html, services.html, contact.html   — public site
employee/login.html                                    — staff login
employee/dashboard.html                                 — employee home / menu
employee/new-install.html, replacement.html             — master quote builders
employee/condenser-change.html, coil-change.html,
  furnace-change.html, plenum-change.html,
  drainline-maintenance.html, labor.html                — standalone pricing worksheets
employee/duct-cleaning.html, maintenance-plan.html,
  inspection.html, custom-solutions.html                — smaller tools
employee/jobs.html, instruction-manual.html,
  tool-list.html, receipts.html                         — placeholder pages for later
assets/css/style.css                                    — all styling
assets/js/pricing-data.js                                — every price, ported from the workbook
assets/js/worksheet.js                                   — the editable-table engine
assets/js/plenum-widget.js, labor-widget.js               — reusable calculators
assets/js/vendor/supabase.js                              — Supabase client library (self-hosted, not a CDN)
assets/js/supabase-config.js                              — your project URL + public API key
assets/js/auth.js                                         — employee login gate (Supabase Auth)
database/schema.sql, seed.sql                             — the live database structure + starting data
database/README.md                                        — access model and security notes
```

## Changing prices

Everything the *worksheets* display lives in **`assets/js/pricing-data.js`**
— one file, plain JavaScript arrays. Change a number, save, refresh the
page. Every worksheet that uses that data (standalone page *and* the New
Install/Replacement builders) updates together. The same numbers also live
in the `material_catalog` table in Supabase (see `database/README.md`) —
the two aren't wired together yet, so a price change should be made in
`pricing-data.js` for now.

## Employee login

The Employee section uses real accounts (Supabase Auth, email + password)
instead of a shared password — there's no self-signup page by design. To
add a staff member:

1. In your Supabase project dashboard, go to **Authentication → Users →
   Add user**, and create an account with their email and a password
   (have them change it after first login, or use "send invite" if you'd
   rather they set their own).
2. Also confirm, once, under **Authentication → Sign In / Providers**,
   that public email sign-ups are turned off — so nobody can create their
   own account from the login page.

Every table behind the login is protected by Row Level Security: a
signed-in account can read and write everything (matching how the old
shared-password version worked), but a logged-out visitor — or anyone
just holding the public API key — can't reach any of it.

## What's a starter template vs. ported from your workbook

The workbook had no data for **Furnace Change** or a **Maintenance Plan**
sheet, so those two pages ship with reasonable starter numbers you should
review and adjust — everything else (Condenser Change, Coil Change, Plenum
Change, Drainline Maintenance, Labor, Inspection checklist, tonnage/price
tables, zone multipliers) was ported directly from your spreadsheet's
values and formulas.

One formula was tightened up: the original sheet doubled labor for the
*low* estimate when both Condenser and Coil are replaced together, but not
for the *high* estimate. The app now doubles both consistently.

Default toggle states on the New Install / Replacement builders: Condenser,
Coil, and Furnace start ON (a full system swap); Plenum, Drainpan, Relocate,
UV Light, and Duct Cleaning start OFF, since those are job-specific add-ons.

## Public site content to fill in

`contact.html` and `about.html` have bracketed placeholders — phone,
email, business hours, service-area list, license number — search for
`[Add` to find them.

## Hosting it as a real website later

This is a static site, so it will run as-is on any static host (Netlify,
Cloudflare Pages, GitHub Pages, plain shared hosting, etc.) — just upload
the whole folder. The contact form currently opens the visitor's email app
(`mailto:`); once hosted, wiring it to a form service like Formspree is more
reliable than mailto links.

# Field Visit Log — offline PWA + Google Sheets/Drive

Offline-first field-staff visit logging. Staff pick a farmer from your master
list, record the visit (auto date/time/GPS, crop stage, condition, purpose, up to
3 live photos), and it saves on the device offline. When online it uploads each
visit to a **Google Sheet**, with photos saved to a **Google Drive** folder and
their links written into the sheet. Same reliable plain-JS + IndexedDB design as
before — no WebAssembly, no server.

## ⚠️ Privacy — read first
Your farmer data includes **Aadhaar numbers and mobile numbers**. A GitHub Pages
site is **public**, and so is any file in the repo (including `farmers.csv`).
**Do NOT put Aadhaar numbers in `farmers.csv`.** The visit app does not need them.
Mobile numbers are also sensitive — include them only if you accept that risk, or
drop the column. If you must keep full PII private, a public static site is the
wrong host; you'd need an authenticated backend (I can help design one).

## The farmer master list — `farmers.csv`
The app loads `farmers.csv` from the repo (cached for offline use) so staff can
search and pick a farmer. Replace the sample file with your data using **these
exact lowercase headers**:

```
district,block,gp,village,farmer_name,father_name,mobile,farmer_id,gender,caste,crop,seed_variety,seed_class,seed_qty_kg,area_ha,date_distribution,date_sowing
```

Map your columns into these (e.g. "Father's/Husband's Name" → `father_name`,
"Seed Variety" → `seed_variety`, "Class" → `seed_class`, "Seed Quantity (in kg)"
→ `seed_qty_kg`, "Area (in ha)" → `area_ha`, "Date of Distribution" →
`date_distribution`, "Date of sowing" → `date_sowing`). **Leave Aadhaar out.**
Export your sheet as CSV with this header row and commit it as `farmers.csv`.

## What gets logged per visit
Auto: visit date, time, GPS latitude/longitude, staff name, device id, and the
selected farmer's details. Entered: crop stage (Germination / Vegetative /
Flowering / Podset / Harvesting), condition (Good / Average / Poor), purpose,
notes, and up to 3 photos taken with the phone camera.

## Setup
1. **Sheet + endpoint (with photo support):** create a Google Sheet →
   Extensions → Apps Script → paste `apps-script/Code.gs` → Deploy → Web app
   (*Execute as: Me*, *Who has access: Anyone*) → authorise (it now also asks for
   Google Drive access, to save photos) → copy the `/exec` URL.
2. **One edit:** set `ENDPOINT` in `app.js` to that URL.
3. **Farmer data:** replace `farmers.csv` with your farmers (headers above, no Aadhaar).
4. **Publish:** push to a repo → Settings → Pages → Source: GitHub Actions (or
   Deploy from a branch → root). Open the URL, Add to Home screen.

Staff set their name once (stored on the device), then log visits offline; photos
and rows upload when back online.

## Dashboard
The in-app **Dashboard** tab shows this device's numbers: total visits, farmers
covered, visits per active day, and breakdowns by crop stage, condition, staff,
and a 14-day visit-frequency chart.

For an organisation-wide dashboard across **all** staff/devices, build it on the
Google Sheet — either point **Google Looker Studio** (free) at the Sheet for a
live dashboard, or run `analysis/read_visits.R` / `.py`, which summarise visits by
staff, visit frequency per staff per week, and stage/condition breakdowns.

## Notes
- **Photos** are resized on the phone (max ~1000px, JPEG) to keep uploads small,
  then stored in Drive with "anyone with the link" view access so the Sheet links
  open. Restrict the Drive folder afterward if you need tighter access.
- **Sync** uploads one visit per request (so a photo-heavy visit can't overload a
  single call); the rest retry automatically when online.
- **Updating the app:** bump `CACHE` in `sw.js` (v1 → v2) after changes so
  installed phones fetch the new version.

## Update: staff login, admin approval, and in-app team dashboard

**Login + PIN (admin-approved).** New staff open the app, choose "Create profile"
(name, Staff ID, mobile, PIN), which is stored in a `Users` sheet as `pending`.
An **admin approves** by opening that sheet and changing the person's `status`
cell from `pending` to `approved` (or `rejected`). The staff member can then sign
in with their Staff ID + PIN. PINs are stored only as a salted SHA-256 hash.

> Security note: this is lightweight gatekeeping on a public endpoint — it
> controls who logs visits and attributes each visit to a person. It is not
> strong authentication. For that, move to Supabase Auth / a real backend.

**Saved on the device.** After a successful online sign-in, the approved profile
(hashed PIN) is saved on the device, so staff can **sign in again offline** and
stay signed in between sessions. Visits are likewise stored on the device (
IndexedDB) and upload when online. Use "Sign out" to clear the session.

**Admin: approving users.** Open the Sheet → `Users` tab → set `status` to
`approved`. That's the whole approval step. To revoke, set it to `rejected`.

**In-app team dashboard.** The Dashboard tab now has two parts: a **Team
dashboard (all staff)** that pulls live totals from the Sheet (visits by staff,
by crop stage, per day) via the endpoint, and a **This device** summary computed
locally. Tap Refresh to reload team totals (needs internet).

**Richer dashboards in the Sheet (Extensions/Apps Script).** The script adds a
`Dashboard` menu to the Sheet — run **Dashboard → Build / refresh** to generate a
`Dashboard` tab with QUERY summary tables and a native column chart (visits by
staff). You can also connect **Google Looker Studio** to the Sheet for a full
live dashboard. After deploying the updated `Code.gs`, re-open the Sheet once so
the menu appears (grant permissions if prompted).

## Update: farmer/program dashboard + future-proof columns

**Program coverage dashboard.** The Dashboard tab now opens with a **Farmer master
(program coverage)** card computed from `farmers.csv` on the device (works
offline): registered-farmer count, total area, area by crop, block-wise area, and
top varieties by area. It reflects whatever is in `farmers.csv` — replace that
file and the numbers update.

**Adding columns later, without breaking anything.**
- *Farmer list:* `farmers.csv` is read by header name, so you can add new columns
  any time — they're preserved and shown automatically on the farmer card. No code
  change needed.
- *Visit records:* the Sheet now uses a dynamic schema. If you add a new field to a
  visit in future, the Apps Script appends a new column for it automatically and
  leaves existing rows intact (blank in the new column). You never have to
  restructure the sheet by hand.

## Update: staff vs management (view-only) roles + filter fix

**Roles.** The `Users` sheet now has a `role` column. New sign-ups default to
`staff` (can log visits). To make a **management / view-only** account, approve
the user and set their `role` cell to `viewer`. A viewer signs in and sees ONLY
the dashboards (program coverage + team totals) — the New visit and Visits tabs
are hidden, so they can fetch progress but cannot log or edit visits.

> If you already created a `Users` tab before this update, add a `role` column
> header (or delete the tab to let it recreate) so the column lines up.

Zero-login alternative for management: point **Google Looker Studio** at the
Sheet and share that dashboard link — no app account needed.

**Filter fix.** District → Block → GP → Village now cascade correctly (previously
only District registered because child menus were being reset on each change).

## Update: interface icons + micro-animations
Inline **Lucide** SVG icons (MIT License, bundled in `icons.js`, ~4 KB, fully
offline) are wired into the tabs, section headers, field labels, buttons and the
online/offline & sync-status indicators. Added: a save-success check animation,
a "locating" pulse on the GPS field, a camera glyph in empty photo slots, and an
empty-state illustration on the Visits screen. All vector/CSS — no images or GIFs,
no effect on offline behaviour or load size. `icons.js` must be uploaded and is
loaded before `app.js`.

## Update: visit-routine / coverage in the dashboard
Program coverage now shows **how routinely fields are visited**:
- **Farmers covered (%)** — unique farmers visited vs registered in farmers.csv.
- **Avg days between revisits** — mean gap between repeat visits to the same farmer.
- **Farmers by number of visits** — how many were visited once / twice / 3+ times.
- **Visits per week** (team, last 8 weeks) and **visits by weekday** — the cadence.
- Each staff member also sees **their own visits per week** offline on the device card.
Team figures come from the Sheet (tap Refresh, needs internet); coverage % combines
those with the registered-farmer count from farmers.csv. Re-deploy Code.gs as a new
version so the extra stats are computed.

## Update: "Farmers not yet visited" (the coverage gap)
The dashboard now lists registered farmers who have not received a visit — the
most actionable planning view. It computes the gap = farmers in farmers.csv minus
those already visited. Online (after Refresh) it uses the program-wide visited
list from the Sheet; offline it falls back to this device's visits (labelled as
such). Includes a filter box (name / village / ID) and an **Export** button that
downloads the pending farmers as CSV for field planning. Re-deploy Code.gs as a
new version (it now returns the visited farmer IDs).

## Update: in-app photo viewer + staff/management split

**Photo gallery (new Photos tab).** A thumbnail grid with a full-screen viewer.
Tap a photo to open it with a footer showing farmer name, village, crop, variety,
area, crop stage, condition, date and GPS; swipe/arrow to move between photos.
- **Source toggle:** "This device" (your own photos, works offline — photos are now
  kept on the device after upload so the gallery works without a connection) or
  "Team (all staff)" (loads program-wide photos from the Sheet/Drive, needs internet).
- **Sort:** newest, oldest, farmer A-Z, crop, or village.

**Roles finalised.**
- **staff** — full app: New visit, Visits, Photos, Program coverage. Logs visits.
- **viewer (management)** — read-only: Photos and Program coverage only; New visit
  and Visits are hidden and cannot log or edit. Their Photos tab defaults to the
  team feed. Set a user's `role` to `viewer` in the Users sheet to make them management.

Note: keeping photos on the device (for the offline gallery) uses storage over
time; clear old visits, or move photos to Cloudinary/R2 if volume grows.
Re-deploy Code.gs as a new version (it now serves the photo feed).

## Update: viewer cascade directory + photo filter bands
- **Viewer directory** now has the full cascade (State -> Agency -> District ->
  Block -> GP -> Village) plus name/ID search, so management can drill down to a
  village and view any farmer's details. Both pickers (New visit + directory) now
  share one cascade engine.
- **Photo viewer bands:** a time band (Today / This week / This month / All) and a
  crop band (a chip per crop, with a leaf icon) filter the gallery; combine with
  the existing source (device/team) and sort controls.

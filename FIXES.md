# What was wrong, and what was done about it

This document lists the problems found in the original `Vehicle_Parking-main` project and how each one was
fixed. Everything below was re-tested after the fix (77 automated tests, live runs with and without Redis, and a
browser walk-through of the driver, admin and driver-partner journeys on desktop and phone-sized screens).

Section 7 below is not a bug fix – it documents the **Driver Partner domain** (ride captains and valet drivers) that
was added on top of the fixed Admin/User system, and in particular the naming choice the main [README](README.md)
refers back to.

## 1. "API calling errors"

| Problem in the original | Fix |
|---|---|
| Unauthenticated calls got a **302 redirect to an HTML login page**, so the Vue code crashed with `Unexpected token '<' in JSON`. | Every `/api/*` answer is JSON. 401 / 403 / 404 / 409 / 422 / 500 all return `{message, code}` and the front end shows the message in a toast or inline. |
| `create_user(password=generate_password_hash(...))` – Flask-Security hashed it a second time, so **seeded users could not log in**; the admin lived in a second `Admin` table with a different hash. | One `User` table + `Role`s (`admin`, `user`). Passwords use `hash_password` (pbkdf2_sha512 – pure Python, no compiled `bcrypt` needed on Windows). Login body is `{email, password, login_as}` and the token comes back as `user.auth_token`. |
| Header name `Authentication-token`, config keys that Flask-Security does not read, `SECURITY_*` pages colliding with the SPA routes (`/login`, `/register`). | Header is `Authentication-Token`; built-in Flask-Security endpoints moved to `/_security`; CSRF is off for token calls. |
| Endpoints were inconsistent (`/api/parking_lot`, `/api/user/reservations`, `/api/reservations` …), some had two implementations, and some front-end calls hit URLs that did not exist. | Rebuilt as a clean, documented REST API (see README). The front end has **one** API client (`static/js/api.js`) that adds the token, parses JSON safely and turns network failures into readable messages. |
| The "quick reservation" endpoint ignored the chosen slot and always booked *now* for a fixed 2 hours; the payment was a separate call, so a booking could exist without a successful payment. | A booking is created in **one transaction**: validate → check availability → charge → create booking → commit. A declined or invalid payment creates nothing. |
| `requirements.txt` was saved as UTF-16, so `pip install -r requirements.txt` failed; unused packages (Flask-Mail, bcrypt) were listed. | Plain UTF-8 file with only what is used. Verified by installing into a brand-new virtual environment and running the tests. |

## 2. "Routing errors"

| Problem | Fix |
|---|---|
| `import Home from './components/home.js'` but the file is `Home.js` (same for `Login`, `Register`) – **works on Windows, 404 on Linux/macOS**. | Every module path matches the real file name; all view modules are lazy-loaded from one router file. |
| Vue Router ran in the default *hash* mode (`/#/dashboard`), so the app had no real URLs and could not be deep-linked or served with a server-side fallback. | History mode with clean URLs (`/app/bookings/12`, `/admin/lots`) **and** a server catch-all that returns the SPA shell for every non-API, non-static URL. |
| Duplicate routes (`/dashboard` and `/reservations` both mounted `dashboard.js`), and no guard – a driver could open the admin page and vice versa. | Route guards by role: visitors → login, drivers → `/app`, owners → `/admin`; anything else shows a friendly 404 page with a way home. |
| Sign-in always went to a fixed page, and the login screen did not distinguish a driver from a lot owner. | Each role lands on its own dashboard after sign-in, and the sign-in / register forms remember which door (driver or owner) you used. |

## 3. Celery and Redis

| Problem | Fix |
|---|---|
| `task.py` imported `celery` from a module that built a **second, bare Flask app**; tasks ran without app context and could not reach the database or mail settings. | One app factory (`Applications/factory.py`) is used by the web app *and* the worker. Tasks run inside a proper app context. The worker entry point is `Applications.celery_worker.celery`. |
| Mail was never configured (`MAIL_SERVER` missing, `sender=MAIL_USERNAME` = `None`), so every e-mail task failed. | New mailer: real SMTP when `MAIL_*` is set, otherwise the message is written to `instance/outbox/` so you can see exactly what would have been sent. |
| `send_reservation_email.delay()` was called inside the request. **With Redis stopped the booking request crashed with a 500** (or hung on connection retries). | All jobs go through `dispatch()`: a 2 s Redis check, then Celery if it is up, otherwise a background thread. Bookings answer in ~20 ms either way; a failing e-mail can never fail a booking. |
| No periodic jobs at all (no reminders, no overstay alerts). | Celery beat schedule: scan bookings every 5 min (reminders before start/end, overstay alerts), housekeeping hourly. When Redis is down an embedded scheduler thread runs the same jobs. |
| Windows: the default prefork pool crashes. | Documented `--pool=solo`; the start-up banner and the admin **System** page print the exact commands. |
| No way to tell what was wrong. | `GET /api/health` and the admin **System & jobs** page report database, Redis, attached Celery workers, task mode and e-mail mode. |

## 4. Wrong slot-booking date and time

| Problem | Fix |
|---|---|
| The browser sent `toISOString()` but the server did `fromisoformat(x.replace('Z',''))`, dropping the zone; other paths used `datetime.now()` vs `utcnow()`; the calendar built dates with `new Date("Sep 1, 2026")` (browser-dependent) and `toISOString().split('T')[0]`, which shifts the **date by a day** in time zones ahead of UTC (e.g. India after ~05:30). | Single rule: **stored in UTC, sent as ISO-8601 with an offset, shown in the viewer's local time**. Naive timestamps are rejected instead of guessed. The picker works with local `YYYY-MM-DD` + `HH:MM` strings and converts once (`localToMs`). |
| A wrong PC clock made "in the past / in the future" checks wrong. | The client keeps an offset to the **server clock** and validates against it. |
| The quick-reservation endpoint could only start "now" for a fixed 2 hours, and a stay could not be extended. | Full date/time picker (min 30 min, max 72 h, up to 30 days ahead), default start = next quarter-hour ≥ 30 min from now, live end time and price. |
| E-mails and reports mixed time zones. | Everything the server formats for humans uses `APP_TIMEZONE` (default Asia/Kolkata). |

## 5. Features you asked for (all implemented and tested)

* **Book a slot and a lot** – 4-step wizard: when & vehicle → choose slot on the map (or "pick the best for me") → extras → review & pay.
* **Slot map** – per level, rows/bays, EV bays, drive lane, entry/exit; states *available / booked / turnaround gap / closed*; after booking the map highlights **your** slot with directions.
* **Amenities** – EV charging, car wash, valet, fuel station, garage & service bay, car-gadgets shop, convenience store, café, restrooms, air/tyre pump, ATM, 24×7 security. Lot owners switch them on per lot, set price and location; bookable ones can be added to a reservation.
* **Pay for the slot** – dummy card/UPI gateway with clear success / declined / insufficient-funds outcomes; every attempt is stored and listed on the Payments page.
* **Extend the same lot** – pick +15 min … up to what the next booking allows; extra charge is quoted before you pay.
* **Fine when you overstay** – 1.5 × hourly rate per started 15 min, live counter, banner on every page, blocks new bookings until paid; owners can collect at the counter or waive.
* **45-minute buffer** – enforced on both sides of every booking (server-side, in the same transaction as the booking), visible on the map, configurable per lot.
* **Separate dashboards with different implementations** – driver app (top navigation, light cards, bottom tab bar on phones, live booking hero) vs. owner console (dark sidebar, KPI tiles + charts, data tables, live operations desk).
* **Landing page** – new hero with a working quick-search, live statistics, "how it works", the buffer/extension/fine explainer, amenity showcase, live lot cards, pricing plans, FAQ and call-to-action.
* Everything from the "Project Insight" spec: register / login with roles, lot management with rows × columns × floors, automatic slot generation, reservation flow with e-mail, My Bookings with search / filter / sort / cancel and total spend, subscription plans for drivers and lot owners, admin dashboard, relational models.

## 6. Things you should know

* **Database**: the schema changed (bookings have codes, slots have floors, payments are a separate table). If an old `instance/vehicle_Parking.sqlite3` from the original project is found, it is renamed to `vehicle_Parking.sqlite3.legacy-backup` and a new database is created. Nothing is deleted.
* **Single user model**: the separate `Admin` table is gone; an admin is a `User` with the `admin` role. `user@admin.com` is also the *platform* admin who may suspend accounts and edit driver plans (`PLATFORM_ADMIN_EMAIL`).
* **Flask-Mail** was removed (standard-library `smtplib` is used); **bcrypt** was replaced by pbkdf2_sha512.
* **Front end** has no build step: Vue 2, Vue Router, Chart.js and Bootstrap Icons are vendored in `static/vendor/`, so it also works offline. Only the optional Google font needs internet; the page falls back to the system font without it.
* **Demo mode** (`DEMO_MODE=true`) shows a clock widget that moves the app's time forward. Turn it and `SEED_DEMO_DATA` off for a real deployment and set `SECRET_KEY` / `SECURITY_PASSWORD_SALT`.
* The payment gateway is a **dummy** – no real money moves.

## 7. The Driver Partner domain (ride captain / valet driver)

A second, brand-new persona was added **on top of** the already-fixed Admin/User system, without rebuilding or
redesigning either existing dashboard: a driver can now also register as a **ride captain** (point-to-point rides,
needs an approved vehicle) or a **valet driver** (parks/retrieves someone else's car at a lot, no vehicle of their
own required). Both share one `Driver` profile model, KYC flow, availability toggle, earnings, ratings and
notifications, but each has its own request type, state machine and dashboard cards.

| Topic | How it was handled |
|---|---|
| **Reusing what already existed** | No duplicate `User`/`ParkingLot`/`ParkingSpot`/`Reservation`/`Subscription`/`Transaction` model was created. A driver partner is still a `User` row; a ride or valet request can optionally **link to an existing `Reservation`** (only one that is `confirmed` and not yet checked out) and auto-fills the pickup/drop label from that lot – it does not duplicate booking data. The dummy payment gateway, the toast/empty-state/spinner components, the star-rating idea and the `partner.css` job-card/handover-grid styles are all shared code, reused as-is by the rider-facing "Rides & valet" pages instead of being re-implemented. |
| **The naming collision** | Flask-Security's role system only has two roles that matter to login (`admin`, `user`) plus, now, a third: `driver`. That is the literal role name Flask-Security stores for a driver **partner** – but the pre-existing spec and every existing screen already use the word "driver" for the **parking customer**. Renaming the customer role was out of scope (rule: do not redesign the existing domains), so the collision is resolved entirely in **wording, not code**: every new screen, nav label and message says "driver partner", "ride captain" or "valet driver", never bare "driver", and the front-end route prefix is `/partner` (not `/driver`) so URLs read unambiguously too. The admin nav has two separate entries – "Drivers" (parking customers, unchanged) and "Driver partners" (the new directory) – right next to each other so they cannot be confused. |
| **No real external APIs** | KYC review, the vehicle document check, GPS/location capture and payments are all dummy/manual: KYC and vehicle documents are approved or rejected by a platform admin from the dashboard (no real ID-verification service); "location" fields are free-text labels or a distance slider, not a live map/GPS feed; ride fare and valet fee are computed with a fixed formula (base fare/fee + per-km + per-minute + a peak-hour surge multiplier) rather than any pricing API, and are paid through the same dummy card/UPI gateway already used for parking bookings. |
| **Minimal Admin additions** | The existing admin dashboard, its sidebar, KPI tiles and tables are untouched. Three new items were added: a **Driver partners** directory + KYC/vehicle review, a platform-wide **rides & valet monitor**, and a **driver partner revenue** report (platform commission vs. driver payouts). The directory is visible to any lot admin (read-only); KYC/vehicle approval and the rides/valet/revenue views require the *platform* admin specifically (`PLATFORM_ADMIN_EMAIL`, defaults to `user@admin.com`) and return 403 for any other admin. |
| **Minimal User additions** | The existing driver (customer) dashboard is untouched apart from one new nav link, "Rides & valet". It opens a small hub (ride/valet tabs, status filters) backed by the same request/cancel/pay/rate actions the driver-partner side exposes, plus one small card on an active booking's detail page ("Need a ride or valet?") that pre-fills the request with that booking's lot. |
| **Test coverage** | `tests/test_driver_domain.py` adds 30 tests on top of the original 37: registration and KYC/vehicle approval and rejection, being blocked from going online until approved, the full ride and valet state machines end-to-end (including asserting the platform-commission/driver-earning split adds back up to the fare/fee actually charged), the shared job pool (a ride captain cannot accept a valet job or vice-versa, and a job can only be accepted once), cancellation-fee timing (free before the driver arrives/reaches pickup, fee after), the reservation-linking rules (only your own, still-active reservation can be linked), and that the platform-admin-only endpoints reject a non-platform admin. All 67 tests pass together in one run. |

## 8. "Something went wrong on our side" reports, login wording and resilience hardening

After the driver-partner domain shipped, three reports came back: the `/app` dashboard, `/app/book/<id>` and the
ride-fare payment step all sometimes showed *"Something went wrong on our side. Please try again."* - plus a request
to make the `/login` and `/partner/login` pages less confusing about which one to use, and a note that "the map" was
missing on both the rider and driver-partner side.

| Topic | What was found / done |
|---|---|
| **Reproducing the error** | That exact message is hard-coded in exactly one place - the server's catch-all `@app.errorhandler(Exception)` in `Applications/routes.py`, which only fires for a genuinely **unhandled** exception (never for a normal validation error, which always raises `ApiError` and gets its own clean message). It was chased hard: every endpoint on the reported pages was hit directly with curl (including the exact UPI id `hahaha@bbnk`, which the dummy gateway happily accepts - only an id starting with `fail` is declined), the full user flow was replayed click-by-click in a real browser end to end (dashboard → book a lot → slot map → old bookings → request a ride → captain accepts/arrives/starts/completes → rider pays by UPI in the actual modal) on a completely fresh database, and a concurrency stress test hammered the API with dozens of simultaneous reads/writes. All of it came back clean - zero server tracebacks, zero console/network errors - so the exact failure could not be reproduced here. If it happens again, the server now always prints the full Python traceback to the terminal it's running in (`current_app.logger.exception(...)`, already in place before this round) - please copy that traceback over, it will point straight at the real cause. |
| **Hardening anyway** | Two real, if narrower, risk spots were tightened even without a reproduced crash. `UserHome.js` (`/app`) loaded bookings, lots and the subscription with a single `Promise.all` - one slow/failing call blanked *all three* and showed the wifi-error banner even though the other two had loaded fine; it now uses `Promise.allSettled` so each piece renders independently and only the piece that actually failed is called out. `BookingWizard.js` (`/app/book/<id>`) fetched the lot and the rider's booking history together the same way, so a hiccup fetching booking history alone could show "Can't open this lot" for a lot that loaded fine; the two fetches are now independent and only a failure to load the **lot itself** blocks the page. Separately, SQLite now runs in **WAL journal mode** with a 15s busy-timeout on every connection (`Applications/factory.py`) - the default SQLite mode lets one writer block every reader for the whole transaction, which is the one mechanism that could plausibly produce a genuine, hard-to-catch server error under the two-tabs-at-once (rider + driver-partner) usage pattern that was described; WAL lets reads keep going while a write is in progress. |
| **"Map is missing"** | Not a bug: real GPS/maps are out of scope by the original spec (dummy integrations only, see the table in §7 and `RequestMobility.js`'s own comment - "No real GPS here - just tell us where from and where to"). The only literal map in the app is the parking **slot map** (level/row/bay grid), which only ever existed on the rider's booking pages and the admin's live slot board - it was never part of the driver-partner side, which has no slots to show. Both were re-verified working in this round. *(Updated in §12: a real, click-to-pick OpenStreetMap map was later added for the ride/valet pickup-drop pins specifically, as an explicit, user-approved exception - the slot map and this statement's reasoning otherwise still stand.)* |
| **Login-page wording** | The main `/login` page's role tile said **"Driver"** for the parking customer, right next to the brand-new "driver partner" (ride captain/valet driver) role - the exact ambiguity reported. That tile (and the matching "Sign in as driver" button text, the demo-login button, and the equivalent tile on `/register`) now say **"User"** instead; nothing about the role itself changed, only the label. `/partner/login` already said "ride captain" / "valet driver" and was left as-is. A direct link between the two was added in both directions - the bottom of `/login` now links to `/partner/login` ("Driving for us instead? Sign in as a ride captain or valet driver"), and the landing page footer links to both "User sign in" and "Partner sign in (captain/driver)" - so there's always a visible path from one to the other. See the README's role table for the full at-a-glance URL/role/demo-login reference. |
| **Landing-page rebrand** | Folded into this same package: the "VparkEasy" wordmark, the two BMS badge images (embedded as base64 data URIs, no separate image files to import) and the two mottos live in `static/js/views/landing/Landing.js` only, exactly as requested. They do not appear on other pages (login, dashboards, admin, partner) because those all share one `brand-logo` component that was intentionally left untouched, per the "don't redesign existing screens" rule - only the landing page asked to be rebranded. |

## 9. Follow-up round: slot/vehicle conflicts, still-unreproduced 500s, copyright, and a route map

A second round of screenshots showed the same *"Something went wrong on our side"* message on `/app/bookings` and
`/app/payments`, a *"Someone just booked this slot for that time"* toast while choosing a slot, and a *"Vehicle ...
already has a booking that overlaps this time"* toast at checkout - plus a request to extend the footer copyright and
to actually add a map on the rider and driver-partner sides for ride/valet navigation.

| Topic | What was found / done |
|---|---|
| **The slot and vehicle "conflict" toasts** | Traced both messages to their exact source (`Applications/availability.py`'s `assert_slot_free` / `assert_vehicle_free`) and confirmed they are **correct rejections, not bugs**. The slot-map endpoint that colours a slot "available" runs the identical `candidates()`/`relation()` logic that the booking-confirm step re-checks a moment later, so a slot cannot legitimately show as free and then be refused - it only fires when a real, overlapping reservation already exists for that slot or that vehicle number. The most likely explanation is an earlier booking attempt that actually succeeded but was never seen as confirmed, because `/app/bookings` was failing to load (see below) at the same time - the fix there should stop this from recurring. Nothing was changed here because nothing was wrong here. |
| **`/app/bookings` and `/app/payments` still crashing** | Chased at least as hard as round one: a real booking (with an EV-charging add-on) was created end-to-end via curl and `GET /api/bookings` returned clean, correct data immediately afterward; dozens of malformed/edge-case payloads were thrown at every related endpoint and each was rejected cleanly with a 400/409 - never a 500; seeded history data was confirmed to always be in the past (`Applications/seed.py`, `_seed_history`) so it cannot collide with a same-day booking; `requirements.txt` pins every functionally-relevant package, ruling out version drift. No crash was reproduced. Rather than report "still can't find it" a second time with nothing to show for it, **persistent error logging was added**: every unhandled server error was already logged with a full traceback, but now that also lands in a plain-text file, `instance/error.log` (rotated at 2MB, 3 backups kept - see `_install_error_log_file` in `Applications/factory.py`), and the log line now also records *which user* was signed in and the *request body* that triggered it (`Applications/routes.py`). If this happens again, that file will have the exact answer without needing to catch it live in a terminal. |
| **Copyright line** | The landing page footer now reads "© 2024 VparkEasy - a BMS MotoVerse" followed by a small car-front icon in the brand's teal accent colour, in place of the old plain "© 2024 VparkEasy." (`static/js/views/landing/Landing.js`). |
| **"Have you added the map"** | Added, on both sides, as an honestly-labelled **illustrative route** rather than a real map - this project's no-real-external-API rule (§7's table) means no Google Maps/GPS key can be wired in, so a live "turn left in 200m" map was never in scope. The new `RouteMap` component (`static/js/views/partner/partnerLib.js`, re-exported through `static/js/views/user/mobilityLib.js` the same way every other shared ride/valet piece is) draws a pickup pin, a drop pin, a curved path between them, a green "distance covered" overlay, and a small car marker that moves along the curve as the job's status advances (still at pickup while it's being matched/approached, midway once the ride/vehicle is actually moving, at the drop pin once complete) - with a permanent "Illustrative route ... no live GPS in this demo" caption so it's never mistaken for a real map. It sits on both the rider's ride/valet detail page (`static/js/views/user/MobilityDetail.js`) and the driver partner's job detail page (`static/js/views/partner/PartnerJobDetail.js`), right above the existing status step-rail, using the same `pickup_label`/`drop_label`/`distance_km`/`status` fields both pages already had - no new API endpoint or model was needed. The parking **slot map** (level/row/bay grid) is unrelated and unchanged. *(Superseded where real coordinates exist - see §12's `LiveRouteMap`; this illustrative `RouteMap` is now the automatic fallback for a request made without the map, so it is still very much in the codebase, just no longer the only option.)* |

## 10. A browser-side 403 that never reached the server, and a less alarming Redis banner

One more report came in: `http://127.0.0.1:5000` showed Chrome's own "Access to 127.0.0.1 was denied - HTTP ERROR 403"
page, even for the bare home page and even in Incognito - plus a request to "fix" the console line that says Redis
isn't running.

| Topic | What was found / done |
|---|---|
| **The 403 page** | Confirmed this is not the application: the server's own terminal log showed a completely clean startup with zero request lines for the failing loads - meaning the browser's requests never reached the Flask process at all. A 403 status specifically means *some* HTTP server answered (a plain connection failure looks different in Chrome - "This site can't be reached" - not "HTTP ERROR 403"), so something between the browser and the app - most likely security/antivirus "web protection," a corporate or parental content filter, or a system-wide proxy - was intercepting the request and answering on the app's behalf. This was re-verified end to end in a clean environment for this round (fresh `pip install`, fresh database, full pytest run, and a full browser click-through of the dashboard, My Bookings and Payments pages) with zero errors, confirming the shipped code itself is not the source. |
| **Redis startup message** | Not a bug, but the old wording (`Redis: not reachable`) read like an error even though the very next lines already explained it was fine. Reworded in `Applications/factory.py`'s `_banner()` so the reassurance comes first and is unambiguous: it now says outright that Redis is optional, that background jobs simply run inside the same process without it, and that "everything in the app works normally either way" - before ever mentioning that Redis isn't running. Purely a log-message change; behaviour is identical either way. |

## 11. RESOLVED: the "Something went wrong on our side" 500s (My bookings / Payments / paying)

The exact crash chased since §8, without success, was finally reproduced from a full terminal traceback the
user pasted after hitting it live: `sqlite3.OperationalError: no such column: payment_transaction.ride_id`.

**Root cause.** `PaymentTransaction` gained two columns (`ride_id`, `valet_id`) when the driver-partner
domain added ride/valet payments that link back to their job (§7). `db.create_all()` - called on every
startup - only creates tables that don't exist yet; it never adds a new column to a table that's already
on disk. Anyone who had run an earlier copy of this app already had a `payment_transaction` table on disk
*without* those two columns, and every request that reads or writes that table (`GET /api/bookings`,
`GET /api/payments`, `POST /api/bookings`, paying a ride/valet fare) crashed with exactly that error - a
real, 100%-reproducible bug, just one that could never show up in this environment because every test here
always started from a database built fresh from the *current* models, never one carried forward from an
older version of the code.

The existing `_backup_legacy_sqlite()` guard (§1) already existed for precisely this class of problem, but
it only checked two specific, older columns (`reservation.code`, `parking_spot.floor`) - it had no idea
about `payment_transaction`'s newer columns, so this specific drift slipped straight through it.

**The fix.** `_backup_legacy_sqlite()` (`Applications/factory.py`) no longer hardcodes which columns to
check. It now walks every table SQLAlchemy's models define (`db.metadata.tables`), and for any table that
already exists on disk, compares its actual columns against what the current models expect. If anything is
missing anywhere, the whole file is treated as outdated and moved aside (`*.legacy-backup` - never deleted)
exactly as before, so a complete, fully-current database is created immediately after. This closes the door
on this *entire class* of bug, not just today's specific columns - any future model change that adds a
column to an existing table is now covered automatically, with no code change needed here again.

**Proof, not just a plausible-sounding fix.** `tests/test_db_migration_guard.py` (2 new tests, now part of
the permanent suite) builds a real on-disk SQLite file, deliberately drops `ride_id`/`valet_id` from
`payment_transaction` to reproduce the reported file byte-for-byte, boots the app against it, and asserts:
the stale file gets backed up (not deleted or silently mutated), the new file has the missing columns, and
- most importantly - `GET /api/bookings` and `GET /api/payments` now return a clean 200 instead of a 500.
A second test confirms an already-current database is left completely untouched (no false positives). Both
were also verified by hand outside of pytest: a database was intentionally downgraded to the exact reported
schema, the app was booted against it, and the full failing flow was replayed end-to-end (login → find an
available slot → pay for a real booking → check My bookings → check Payments) and confirmed working, with
the pre-existing (now-fixed) data preserved in the `.legacy-backup` file rather than lost.

**If you already hit this**: nothing to do - just run the updated app once. It will notice your old
database on its own, move it to `<filename>.legacy-backup` right next to it (your old data is not deleted),
and build you a fresh, fully-working one in its place.

## 12. A real map (not the illustrative one), and the cost shown upfront instead of after the ride

The next request was explicit: "add a real map for the user to select their location and the captain to use
the same map to navigate and reach the place, also mention the cost for the travel previously instead of
showing them after reaching the destination." A real, click-to-pick map is a genuine external dependency -
it needs map tiles from a live service - which is exactly what the project's no-real-external-API rule (§7's
table, and §8's "map is missing" answer) had been holding the line against. Rather than unilaterally bend a
rule that had been reinforced multiple times, this was put back to you directly as a choice - real
OpenStreetMap tiles (free, no sign-up/API key/billing) vs. staying fully offline with the illustrative map
improved instead - and you chose real OpenStreetMap. That is the one deliberate, explicitly-agreed exception
in this whole project: map **tiles** now load live from the public OpenStreetMap tile server while the app is
running. Payments, KYC and the fare/fee *formula* are all still 100% dummy/local, exactly as before.

| Topic | What was found / done |
|---|---|
| **Leaflet, vendored like everything else** | The map library itself is [Leaflet](https://leafletjs.com) 1.9.4 - not loaded from a CDN, but vendored under `static/vendor/leaflet/` (the `.js`, `.css` and marker images) exactly the way Vue, Vue Router and Chart.js already are, and loaded as a plain `<script>`/`<link>` tag in `templates/index.html` (global `L`, same pattern the app already uses for `Vue`/`Chart`). Only the map **tile images themselves** - little PNG squares of street map - come from the network at runtime (`tile.openstreetmap.org`); if that one request can't reach the internet the map area simply shows grey squares while every other button, pin, line and marker still works, because none of that logic depends on the tiles loading. |
| **Picking a real pickup/drop location** | `RequestMobility.js` ("Book a ride" / "Request valet") now embeds a new `LocationPickerMap` component (`static/js/views/partner/partnerLib.js`, re-exported through `mobilityLib.js` the same way every other shared ride/valet piece is): a real, scrollable/zoomable OpenStreetMap view where tapping the map (or dragging a pin) drops a real pickup pin, then a real drop pin, connected by a dashed line. A "Use my location" button uses the browser's own geolocation API (no external service) to jump straight to the rider's actual position. There is deliberately **no address search/autocomplete** - that would need a second, rate-limited geocoding service on top of the map tiles, which was not part of what was agreed, so the existing free-text pickup/drop labels are kept alongside the map for a human-readable description. The old manual "approximate distance" slider is kept too, purely as a fallback for when the map isn't used (offline, geolocation denied, or the rider just prefers typing a number) - as soon as both pins are set, the slider is replaced by "Distance measured from the map: _x_ km" and that measured number is what actually gets used. |
| **The distance is measured by the server, not trusted from the browser** | `driver_service.py`'s new `_resolve_distance()` computes the real straight-line ("as the crow flies") distance between the two pins itself, server-side, using a new `utils.haversine_km()` helper - it never trusts a client-sent `distance_km` once real coordinates are present, closing off an obvious way someone could otherwise lowball the distance to cheat the fare. That raw straight-line number is then padded by a new `ROAD_DISTANCE_FACTOR` config constant (default `1.3`) - a dummy "roads aren't a straight line" allowance, since there is still no real routing/turn-by-turn service computing an actual road distance. `Ride`/`ValetRequest` gained four new nullable columns (`pickup_lat`/`pickup_lng`/`drop_lat`/`drop_lng`) to store the real pins; they are `NULL` for any request made without the map (old data, or the manual-slider fallback), which is exactly the "missing column" pattern §11's migration guard already knows how to heal automatically on an upgrade. |
| **The captain's "navigate through the map"** | The **same** `LocationPickerMap`-adjacent component family adds `LiveRouteMap`, which replaces the old illustrative `RouteMap` wherever real pickup/drop coordinates exist - on both the rider's ride/valet detail page (`MobilityDetail.js`) and the driver partner's job detail page (`PartnerJobDetail.js`), so both sides look at the literal same map. It shows a real OpenStreetMap view centred on the two pins, a dashed straight-line path between them (never full turn-by-turn directions - that scope was explicitly ruled out when you picked this option, since it would need a separate routing/directions service), and a car marker that moves along that line as the job progresses (still driven by the existing `ridePos()`/`valetPos()` status logic, not real GPS tracking - the on-screen caption says so plainly). Any job with no coordinates (made before this feature, or via the manual-distance fallback) automatically falls back to rendering the original illustrative `RouteMap` instead, so nothing that already worked can break. |
| **The cost, shown before you request - not after** | New endpoints `POST /api/rides/quote` and `POST /api/valet/quote` (`driver_service.estimate_ride_fare()` / `estimate_valet_fee()`) compute an estimate from either the map pins or the manual distance, using the same fare-formula constants the final charge already used (`RIDE_BASE_FARE`, `RIDE_PER_KM_RATE`, `RIDE_PER_MIN_RATE`, peak-hour surge, `VALET_BASE_FEE`, `VALET_PER_KM_RATE`) plus two new estimate-only constants - `RIDE_AVG_SPEED_KMPH` (assumed city-traffic speed, used to turn distance into an assumed travel time) and `RIDE_ESTIMATE_LOW_FACTOR`/`RIDE_ESTIMATE_HIGH_FACTOR` (turn one number into a low-high band for rides, since the *real* fare still depends on actual wait time and the exact moment a captain accepts - a ride estimate is a band, not a false promise of one exact number; a valet fee has no waiting-time variable, so it stays one number). `RequestMobility.js` calls this (debounced ~400ms) every time the pins or the manual distance change and shows the result in a highlighted panel right above the "Request ride"/"Request valet" button, with a peak-hour-surge pill and a one-line disclaimer that it is an estimate. The final, authoritative fare/fee - computed from the *actual* elapsed time once the trip really happens - is completely unchanged and still shown on the detail page exactly as before; this only adds the upfront number, it does not replace the settlement logic. |
| **Test coverage** | `tests/test_driver_domain.py` adds 8 new tests: both quote endpoints from a manual distance and from real map points (including that an unauthenticated call is rejected and a call with neither pins nor a distance is a clean 400, not a 500), and that requesting a ride/valet with map points stores the real lat/lng and **measures its own distance** even when a deliberately wrong `distance_km` is also sent in the same request (proving the server-side override actually happens, not just that it theoretically could). A request made without any map points is asserted to still work exactly as before, with `pickup_lat`/`drop_lat` left `null`. All 77 tests pass together in one run. Verified live in a real browser too, on both desktop and a phone-sized viewport: dropping pins, dragging them, "Use my location," the live cost estimate updating, submitting a ride, the driver partner accepting and advancing it with the marker visibly moving along the same real map, and the pre-existing illustrative map still rendering correctly for a request made without pins. |

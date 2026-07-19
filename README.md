# Photobooth

A portable, self-hosted photobooth web app. Guests capture photos in the
browser (no native app), get them via QR code or email, and admins manage
events from a small dashboard. See the original spec for full background;
this README covers what's implemented and how to run it.

## Stack

- **Backend:** PHP 8.1+, [Slim 4](https://www.slimframework.com/) for routing/middleware, raw PDO for persistence (no ORM).
- **Database:** SQLite by default (zero-config, single file at `storage/photobooth.sqlite`). Swappable to MySQL/Postgres later by changing the DSN in `src/Support/Database.php` — the schema in `database/schema.sql` avoids SQLite-only syntax where practical.
- **Frontend:** Plain HTML/JS, no framework or build step. Styling is [Bulma](https://bulma.io/) (CSS-only, no JS, mobile-first/responsive by default) plus [Bootstrap Icons](https://icons.getbootstrap.com/) (MIT-licensed SVG/webfont icon set) — both vendored directly into `public/assets/vendor/` (see below) rather than hand-rolled CSS, so there's no design system to maintain by hand.
- **Email:** Amazon SES via its SMTP interface (through PHPMailer).
- **Images:** GD (bundled with PHP) for logo/photo re-encoding.

## Directory layout

```
public/            Web root. Static pages (booth/, admin/, photo/) + index.php front controller.
  booth/            Guest-facing capture flow (loaded via ?code=BOOTH-CODE)
  admin/            Admin dashboard (session-cookie auth)
  photo/            "Your photo" page a QR code links to
  assets/           Shared css/js for the above
    vendor/           Bulma + Bootstrap Icons, vendored (not npm/CDN — see Styling below)
    css/              Small app-specific overrides only (see comments in each file)
    js/               admin.js, booth.js — no build step, loaded as plain <script> tags
  media/, archive/  Routed through Slim (src/routes.php), not real directories
src/
  Controllers/      One class per route group (Auth, Event, Photo, Gallery, Archive, Media)
  Services/         StorageService, ImageService, MailService, QrCodeService, SignedUrlService
  Middleware/        AdminAuthMiddleware (session check)
  Support/           Config loader, PDO bootstrap, UUID helpers
  bootstrap.php      DI container wiring
  routes.php         Route table
database/schema.sql  SQLite schema (admins, events, photos, settings)
storage/             Uploaded logos, live event photos, archived zips (gitignored, outside public/)
bin/
  create_admin.php      Seed/update an admin account
  retention_cron.php    Daily lifecycle sweep (see Retention below)
  backstop_cleanup.sh   OS-level disk safety net, independent of the app
```

Photos and logos are stored outside `public/` and streamed through PHP
(`/media/photos/{uuid}`, `/media/logos/{uuid}`) rather than served as static
files, so storage layout isn't part of the public URL surface.

## Setup

```bash
composer install
cp .env.example .env
```

Edit `.env`:
- `APP_SECRET` — generate with `php -r "echo bin2hex(random_bytes(32));"`. Used to sign archive-download URLs.
- `APP_URL` — the public URL this app will be served from (used to build booth/QR/download links).
- `SES_SMTP_*` — your Amazon SES SMTP credentials (Amazon SES console → SMTP Settings).
- Retention/cap values — see `.env.example` for defaults; all are tunable without code changes.

Create your first admin:

```bash
php bin/create_admin.php you@example.com 'a-strong-password'
```

The SQLite database and its schema are created automatically on first
connection (see `Database::connect()`), so no separate migration step is
needed.

### Local dev server

```bash
php -S localhost:8080 -t public public/router.php
```

`public/router.php` is a dev-only front controller router (mirrors what
`.htaccess` does under Apache) — it is not needed in production if your
webserver already handles this via `public/.htaccess`.

Then visit `http://localhost:8080/admin/` to log in and create an event, or
`http://localhost:8080/booth/?code=YOUR-CODE` to try the booth flow.

### Production (Apache vhost)

Point the vhost's document root at `public/`. `public/.htaccess` routes
requests for real files/directories straight through, and everything else to
`index.php` (Slim). Make sure `mod_rewrite` is enabled. For nginx, the
equivalent is a `try_files $uri $uri/ /index.php?$query_string;` rule.

Set up the retention cron (see below) and, optionally, the OS-level backstop
script in your crontab.

## Styling

All three pages (`admin/`, `booth/`, `photo/`) load two vendored, self-hosted
libraries rather than hand-coded CSS:

- **[Bulma](https://bulma.io/)** (`public/assets/vendor/bulma/bulma.min.css`)
  — a CSS-only framework (no JS), responsive/mobile-first by default, which
  is why the booth works unmodified on phones, tablets, and an event iPad.
  All layout, forms, buttons, cards, and colours come from its classes
  (`box`, `card`, `field`/`control`, `button is-primary`, `is-hidden`,
  Bulma's own dark-mode support, etc.).
- **[Bootstrap Icons](https://icons.getbootstrap.com/)**
  (`public/assets/vendor/bootstrap-icons/`) — an open-source (MIT), webfont-
  based icon set. Icons are just `<i class="bi bi-camera-fill"></i>` tags.

Both are vendored directly into the repo (not pulled from a CDN or via npm)
so the booth still works if an event's wifi is flaky and the app doesn't
need a JS build step. To upgrade either library, download a newer release
and replace the files under `public/assets/vendor/{bulma,bootstrap-icons}/`
— see the `LICENSE` file alongside each for attribution terms.

The only custom CSS in the app is `public/assets/css/admin.css` and
`booth.css`, and both are deliberately small: they hold *only* the handful
of things Bulma has no component for (the fullscreen mirrored camera view
and countdown overlay on the booth, the photo thumbnail grid on the admin
gallery, print-only output rules). Every file starts with a comment
explaining why it exists — read that comment before adding a new rule, and
prefer an existing Bulma class first. The one legitimate use of an inline
style is the admin-configured event background colour, which is genuinely
per-event *data* (like an `<img src>`) rather than a design choice, so it's
set at runtime in JS (`booth.js`, `admin.js`) instead of being a CSS rule.

## How it works

- **Events**: an admin creates an event (name, background colour, optional
  logo), which generates a short booth code and a booth URL
  (`/booth/?code=XXXX-XXXX`) to load on the event's iPad/device.
- **Booth flow**: `getUserMedia` live preview → guest picks single photo or
  3-shot strip → countdown → capture → branding (logo + background colour)
  is composited client-side onto a `<canvas>` → guest reviews/retakes →
  uploads the final image. The server re-encodes every upload through GD
  before writing it to disk (never trusts raw uploaded bytes).
- **Delivery**: guests get a QR code linking to `/photo/?id={uuid}` (just
  their photo, not the event gallery) and/or can email themselves a copy via
  SES. A print button uses the browser's native print dialog (AirPrint-
  compatible on iOS, no extra integration).
- **Caps**: each event has a photo-count and/or storage-size cap (both
  configurable per event at creation, with server-wide defaults in `.env`).
  Once hit, the booth shows a "this event is full" screen instead of a raw
  error. A global storage cap blocks *new event creation* (rather than
  silently purging other admins' data) once reached.

## Retention lifecycle

Implemented in `bin/retention_cron.php`, intended to run daily via cron:

```cron
0 3 * * * php /path/to/photobooth/bin/retention_cron.php >> /var/log/photobooth-retention.log 2>&1
```

1. **Active** (day 0–7, configurable via `RETENTION_ACTIVE_DAYS`): event is
   live, booth accepts captures, admin can view/download the live gallery.
2. **Archive trigger** (`expires_at` passed): live photos are zipped into
   `storage/archives/{event_uuid}.zip`, the live gallery is deleted, and the
   admin gets an email with a signed, expiring download link
   (`SignedUrlService`, HMAC-based — not a guessable static URL).
3. **Archive window** (another `RETENTION_ARCHIVE_DAYS`, default 7): archive
   is downloadable only via that signed link (`ArchiveController::download`,
   streamed with `readfile()` per spec, not a redirect). An optional
   reminder email goes out ~2 days before the deadline.
   - **Download-triggered early deletion**: on a *successful* download (
     `!connection_aborted()` after the full `readfile()` completes), the
     purge deadline is pulled forward to `now + RETENTION_DOWNLOAD_GRACE_HOURS`
     (default 1h) instead of waiting out the full window — but not deleted
     instantly, so a flaky connection can retry without risking the admin's
     only copy.
4. **Purge**: whichever `archive_purge_after` deadline arrives first (day-14
   sweep or post-download grace buffer) gets swept by the same cron job —
   the zip is deleted and the event record is marked `purged` (kept as a
   lightweight stub, not deleted, per spec).

`bin/backstop_cleanup.sh` is a separate, independent OS-level safety net
(plain `find -mtime` deletes) in case the app-level logic above ever has a
bug — it uses much longer age thresholds and should never fire in normal
operation.

## Open items from the spec (defaults chosen, easy to revisit)

- **Global cap behavior**: blocks new event creation and returns a 507 with
  a message, rather than auto-purging other events' data (per the spec's
  stated lean).
- **Admin auth**: single-table email+password (bcrypt via `password_hash`),
  PHP session cookies. No 2FA/SSO — straightforward to swap for something
  stronger later without touching the rest of the app (only
  `AuthController` + `AdminAuthMiddleware`).
- **Storage layout**: `storage/{events,archives,logos}/`, keyed by event/photo
  UUIDs (see Directory layout above).
- **Grace buffer**: 1 hour post-download (`RETENTION_DOWNLOAD_GRACE_HOURS`).

## Not implemented / explicitly out of scope

Per spec: no native app, no green screen/filters/AR effects, no CRM or
business tooling, no Web Share API (QR + email only), no permanent hosted
galleries.

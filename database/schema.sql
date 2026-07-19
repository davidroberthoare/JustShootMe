-- Photobooth database schema (SQLite)
-- Swappable to MySQL/Postgres later; kept to portable ANSI-ish SQL where practical.

CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    booth_code TEXT NOT NULL UNIQUE,
    admin_id INTEGER NOT NULL REFERENCES admins(id),
    name TEXT NOT NULL,
    logo_path TEXT,
    background_color TEXT NOT NULL DEFAULT '#111111',
    photo_cap INTEGER NOT NULL DEFAULT 200,
    storage_cap_bytes INTEGER NOT NULL DEFAULT 524288000, -- 500MB
    photo_count INTEGER NOT NULL DEFAULT 0,
    storage_used_bytes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active', -- active | archived | purged
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL, -- created_at + ACTIVE_DAYS, when stage-2 archiving kicks in
    archived_at TEXT,
    archive_path TEXT,
    archive_size_bytes INTEGER,
    archive_downloaded_at TEXT,
    archive_purge_after TEXT, -- computed purge deadline (download grace buffer or day-14 sweep)
    archive_reminder_sent_at TEXT,
    purged_at TEXT
);

CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    event_id INTEGER NOT NULL REFERENCES events(id),
    type TEXT NOT NULL DEFAULT 'single', -- single | strip
    file_path TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL DEFAULT 0,
    guest_email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photos_event ON photos(event_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_expires ON events(expires_at);

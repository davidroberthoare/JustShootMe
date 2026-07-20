<?php

declare(strict_types=1);

/**
 * Daily retention sweep implementing the spec's two-stage lifecycle:
 *
 *   Stage 1 (active)   -> Stage 2 (archive at expires_at): zip live photos,
 *                         delete originals, email admin a signed download link.
 *   Stage 3 (archived) -> optional reminder 1-2 days before purge.
 *   Stage 4 (purge)    -> delete the archive once archive_purge_after has
 *                         passed (either the day-14 sweep boundary, or the
 *                         short grace buffer set after a completed download —
 *                         whichever comes first, per spec).
 *
 * Intended to run once a day via cron, e.g.:
 *   0 3 * * * php /path/to/justshootme/bin/retention_cron.php >> /var/log/justshootme-retention.log 2>&1
 */

use JustShootMe\Services\{MailService, SignedUrlService, StorageService};
use JustShootMe\Support\{Config, Database};

require_once __DIR__ . '/../vendor/autoload.php';

$rootPath = dirname(__DIR__);
$config = Config::load($rootPath);
$pdo = Database::connect($config);

$storage = new StorageService(
    $config['storage']['events_path'],
    $config['storage']['archives_path'],
    $config['storage']['logos_path'],
    $config['limits']['global_storage_cap_bytes'],
);
$mail = new MailService($config['mail']);
$signedUrls = new SignedUrlService($config['app']['secret'], $config['app']['url']);

$archiveDays = $config['retention']['archive_days'];
$reminderDaysBefore = 2;

function log_line(string $message): void
{
    echo '[' . date('c') . "] {$message}\n";
}

// --- Stage 2: archive events past their active window -----------------------
$stmt = $pdo->query(
    "SELECT events.*, admins.email AS admin_email
     FROM events JOIN admins ON admins.id = events.admin_id
     WHERE events.status = 'active' AND events.expires_at <= datetime('now')"
);

foreach ($stmt->fetchAll() as $event) {
    log_line("Archiving event {$event['id']} ({$event['name']})");

    [$archivePath, $archiveSize] = $storage->zipEventPhotos($event['uuid']);
    $storage->deleteEventPhotosDir($event['uuid']);

    $update = $pdo->prepare(
        "UPDATE events
         SET status = 'archived',
             archived_at = datetime('now'),
             archive_path = ?,
             archive_size_bytes = ?,
             archive_purge_after = datetime('now', ?)
         WHERE id = ?"
    );
    $update->execute([basename($archivePath), $archiveSize, "+{$archiveDays} days", $event['id']]);

    $pdo->prepare('DELETE FROM photos WHERE event_id = ?')->execute([$event['id']]);

    try {
        $downloadUrl = $signedUrls->makeArchiveDownloadUrl($event['id'], $event['uuid'], $archiveDays * 86400);
        $mail->sendArchiveReadyNotice($event['admin_email'], $event['name'], $downloadUrl, $archiveDays);
    } catch (\Throwable $e) {
        log_line("  WARNING: failed to email archive-ready notice for event {$event['id']}: {$e->getMessage()}");
    }
}

// --- Stage 3: reminder emails shortly before purge ---------------------------
$stmt = $pdo->query(
    "SELECT events.*, admins.email AS admin_email
     FROM events JOIN admins ON admins.id = events.admin_id
     WHERE events.status = 'archived'
       AND events.archive_reminder_sent_at IS NULL
       AND events.archive_purge_after <= datetime('now', '+{$reminderDaysBefore} days')"
);

foreach ($stmt->fetchAll() as $event) {
    log_line("Sending archive-expiring reminder for event {$event['id']} ({$event['name']})");

    try {
        $downloadUrl = $signedUrls->makeArchiveDownloadUrl(
            $event['id'],
            $event['uuid'],
            max(3600, strtotime((string) $event['archive_purge_after']) - time())
        );
        $mail->sendArchiveExpiringReminder($event['admin_email'], $event['name'], $downloadUrl, $reminderDaysBefore);
    } catch (\Throwable $e) {
        log_line("  WARNING: failed to email archive-expiring reminder for event {$event['id']}: {$e->getMessage()}");
    }

    $pdo->prepare('UPDATE events SET archive_reminder_sent_at = datetime("now") WHERE id = ?')
        ->execute([$event['id']]);
}

// --- Stage 4: purge archives past their deadline -----------------------------
$stmt = $pdo->query(
    "SELECT * FROM events WHERE status = 'archived' AND archive_purge_after <= datetime('now')"
);

foreach ($stmt->fetchAll() as $event) {
    log_line("Purging archive for event {$event['id']} ({$event['name']})");

    $storage->deleteArchive($event['uuid']);

    $update = $pdo->prepare(
        "UPDATE events
         SET status = 'purged', purged_at = datetime('now'), archive_path = NULL
         WHERE id = ?"
    );
    $update->execute([$event['id']]);
}

log_line('Retention sweep complete.');

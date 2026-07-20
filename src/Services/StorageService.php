<?php

declare(strict_types=1);

namespace Photobooth\Services;

use RuntimeException;
use ZipArchive;

/**
 * Owns the on-disk layout for event photos, logos, and archives, plus the
 * per-event / global cap checks called out in the spec's Data Retention section.
 *
 *   storage/logos/{logo_id}.{ext}
 *   storage/events/{event_uuid}/{photo_uuid}.jpg
 *   storage/archives/{event_uuid}.zip
 *
 * Logos are keyed by their own fresh id (not the event's uuid) so that
 * replacing an event's logo always produces a brand-new URL — otherwise a
 * browser or CDN caching the old /media/logos/{event_uuid}.png response
 * could keep serving the stale image after an admin uploads a new one.
 */
final class StorageService
{
    public function __construct(
        private readonly string $eventsPath,
        private readonly string $archivesPath,
        private readonly string $logosPath,
        private readonly int $globalStorageCapBytes,
    ) {
    }

    public function eventPhotosDir(string $eventUuid): string
    {
        $dir = $this->eventsPath . '/' . $eventUuid;
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        return $dir;
    }

    public function photoPath(string $eventUuid, string $photoUuid, string $extension = 'jpg'): string
    {
        return $this->eventPhotosDir($eventUuid) . '/' . $photoUuid . '.' . ltrim($extension, '.');
    }

    public function logoPath(string $logoId, string $extension): string
    {
        if (!is_dir($this->logosPath)) {
            mkdir($this->logosPath, 0775, true);
        }
        return $this->logosPath . '/' . $logoId . '.' . ltrim($extension, '.');
    }

    /** Deletes a logo file by its stored filename (the events.logo_path value, e.g. "{logoId}.png"). */
    public function deleteLogoFile(string $filename): void
    {
        $path = $this->logosPath . '/' . basename($filename);
        if (is_file($path)) {
            @unlink($path);
        }
    }

    public function archivePath(string $eventUuid): string
    {
        if (!is_dir($this->archivesPath)) {
            mkdir($this->archivesPath, 0775, true);
        }
        return $this->archivesPath . '/' . $eventUuid . '.zip';
    }

    public function wouldExceedEventCap(int $currentPhotoCount, int $currentStorageBytes, int $photoCap, int $storageCapBytes, int $incomingBytes = 0): bool
    {
        if ($photoCap > 0 && $currentPhotoCount + 1 > $photoCap) {
            return true;
        }
        if ($storageCapBytes > 0 && $currentStorageBytes + $incomingBytes > $storageCapBytes) {
            return true;
        }
        return false;
    }

    public function globalStorageUsedBytes(\PDO $pdo): int
    {
        $stmt = $pdo->query("SELECT COALESCE(SUM(storage_used_bytes), 0) AS total FROM events WHERE status = 'active'");
        return (int) $stmt->fetchColumn();
    }

    public function wouldExceedGlobalCap(\PDO $pdo, int $incomingBytes = 0): bool
    {
        if ($this->globalStorageCapBytes <= 0) {
            return false;
        }
        return $this->globalStorageUsedBytes($pdo) + $incomingBytes > $this->globalStorageCapBytes;
    }

    /** Zips every photo for an event into storage/archives/{uuid}.zip. Returns [path, sizeBytes]. */
    public function zipEventPhotos(string $eventUuid): array
    {
        $sourceDir = $this->eventPhotosDir($eventUuid);
        $zipPath = $this->archivePath($eventUuid);

        $zip = new ZipArchive();
        if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException("Unable to create archive at {$zipPath}");
        }

        foreach (glob($sourceDir . '/*') ?: [] as $file) {
            if (is_file($file)) {
                $zip->addFile($file, basename($file));
            }
        }

        $zip->close();

        return [$zipPath, filesize($zipPath) ?: 0];
    }

    public function deleteEventPhotosDir(string $eventUuid): void
    {
        $dir = $this->eventsPath . '/' . $eventUuid;
        if (!is_dir($dir)) {
            return;
        }
        foreach (glob($dir . '/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($dir);
    }

    public function deleteArchive(string $eventUuid): void
    {
        $path = $this->archivePath($eventUuid);
        if (is_file($path)) {
            @unlink($path);
        }
    }
}

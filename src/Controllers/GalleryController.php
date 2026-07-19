<?php

declare(strict_types=1);

namespace Photobooth\Controllers;

use PDO;
use Photobooth\Services\StorageService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Psr7\Stream;
use ZipArchive;

final class GalleryController extends BaseController
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly StorageService $storage,
    ) {
    }

    /** GET /api/admin/events/{id}/photos */
    public function index(Request $request, Response $response, array $args): Response
    {
        $event = $this->findOwnedEvent((int) $args['id']);
        if (!$event) {
            return $this->error($response, 'Event not found.', 404);
        }

        $stmt = $this->pdo->prepare(
            'SELECT uuid, type, file_size_bytes, created_at FROM photos WHERE event_id = ? ORDER BY created_at DESC'
        );
        $stmt->execute([(int) $event['id']]);

        $photos = array_map(static fn (array $p) => [
            'uuid' => $p['uuid'],
            'type' => $p['type'],
            'image_url' => "/media/photos/{$p['uuid']}",
            'view_url' => "/photo/?id={$p['uuid']}",
            'file_size_bytes' => (int) $p['file_size_bytes'],
            'created_at' => $p['created_at'],
        ], $stmt->fetchAll());

        return $this->json($response, ['photos' => $photos]);
    }

    /** GET /api/admin/events/{id}/download — bulk-zips the live gallery on demand and streams it. */
    public function download(Request $request, Response $response, array $args): Response
    {
        $event = $this->findOwnedEvent((int) $args['id']);
        if (!$event) {
            return $this->error($response, 'Event not found.', 404);
        }

        $sourceDir = $this->storage->eventPhotosDir($event['uuid']);
        $tmpZip = tempnam(sys_get_temp_dir(), 'pb_gallery_') . '.zip';

        $zip = new ZipArchive();
        $zip->open($tmpZip, ZipArchive::CREATE | ZipArchive::OVERWRITE);
        foreach (glob($sourceDir . '/*') ?: [] as $file) {
            if (is_file($file)) {
                $zip->addFile($file, basename($file));
            }
        }
        $zip->close();

        $filename = preg_replace('/[^a-zA-Z0-9_-]+/', '-', $event['name']) . '-photos.zip';
        $stream = fopen($tmpZip, 'rb');

        return $response
            ->withHeader('Content-Type', 'application/zip')
            ->withHeader('Content-Disposition', "attachment; filename=\"{$filename}\"")
            ->withHeader('Content-Length', (string) filesize($tmpZip))
            ->withBody(new Stream($stream));
        // Note: tmpZip is left for the OS tmp-cleaner; for very large galleries consider
        // registering a stream-close callback to unlink() it immediately after send.
    }

    private function findOwnedEvent(int $id): array|false
    {
        $stmt = $this->pdo->prepare('SELECT * FROM events WHERE id = ? AND admin_id = ?');
        $stmt->execute([$id, (int) $_SESSION['admin_id']]);
        return $stmt->fetch();
    }
}

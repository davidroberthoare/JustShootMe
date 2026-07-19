<?php

declare(strict_types=1);

namespace Photobooth\Controllers;

use PDO;
use Photobooth\Services\{ImageService, StorageService};
use Photobooth\Support\Uuid;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Event CRUD for admins (create/list/view), plus the one public,
 * unauthenticated endpoint the booth frontend calls to load an event's
 * branding by its short booth code (publicConfig()). Every admin-facing
 * method here is scoped to the logged-in admin's own events via
 * findOwnedEvent() — there's no route that lets one admin see another's
 * events.
 */
final class EventController extends BaseController
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly StorageService $storage,
        private readonly ImageService $images,
        private readonly array $config,
    ) {
    }

    /** GET /api/admin/events — list this admin's events, newest first. */
    public function index(Request $request, Response $response): Response
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, uuid, booth_code, name, background_color, logo_path, status,
                    photo_count, storage_used_bytes, photo_cap, storage_cap_bytes,
                    created_at, expires_at, archived_at
             FROM events WHERE admin_id = ? ORDER BY created_at DESC'
        );
        $stmt->execute([(int) $_SESSION['admin_id']]);
        $events = array_map([$this, 'present'], $stmt->fetchAll());

        return $this->json($response, ['events' => $events]);
    }

    /** GET /api/admin/events/{id} */
    public function show(Request $request, Response $response, array $args): Response
    {
        $event = $this->findOwnedEvent((int) $args['id']);
        if (!$event) {
            return $this->error($response, 'Event not found.', 404);
        }
        return $this->json($response, ['event' => $this->present($event)]);
    }

    /** POST /api/admin/events (multipart/form-data: name, background_color, photo_cap?, storage_cap_mb?, logo?) */
    public function create(Request $request, Response $response): Response
    {
        // Spec decision: when the server-wide storage cap is reached, block
        // new event creation and surface it to the admin, rather than
        // silently purging some other admin's event to make room.
        if ($this->storage->wouldExceedGlobalCap($this->pdo)) {
            return $this->error(
                $response,
                'Global storage cap reached. Free up space or raise GLOBAL_STORAGE_CAP_MB before creating new events.',
                507
            );
        }

        $body = (array) $request->getParsedBody();
        $name = trim((string) ($body['name'] ?? ''));
        $backgroundColor = trim((string) ($body['background_color'] ?? '#111111'));

        if ($name === '') {
            return $this->error($response, 'Event name is required.', 422);
        }
        if (!preg_match('/^#[0-9a-fA-F]{6}$/', $backgroundColor)) {
            return $this->error($response, 'background_color must be a hex value like #112233.', 422);
        }

        $photoCap = isset($body['photo_cap']) && $body['photo_cap'] !== ''
            ? max(0, (int) $body['photo_cap'])
            : $this->config['limits']['default_event_photo_cap'];

        $storageCapBytes = isset($body['storage_cap_mb']) && $body['storage_cap_mb'] !== ''
            ? max(0, (int) $body['storage_cap_mb']) * 1024 * 1024
            : $this->config['limits']['default_event_storage_cap_bytes'];

        $uuid = Uuid::v4();
        $boothCode = $this->generateUniqueBoothCode();
        $logoPath = null;

        $uploadedFiles = $request->getUploadedFiles();
        if (!empty($uploadedFiles['logo']) && $uploadedFiles['logo']->getError() === UPLOAD_ERR_OK) {
            $logoFile = $uploadedFiles['logo'];
            $tmpPath = sys_get_temp_dir() . '/' . Uuid::v4();
            $logoFile->moveTo($tmpPath);

            // ImageService re-encodes through GD (never trusts the raw upload
            // bytes) and writes straight into permanent storage as PNG.
            $destination = $this->storage->logoPath($uuid, 'png');
            $this->images->saveUploadedLogo($tmpPath, $destination);
            @unlink($tmpPath);

            $logoPath = basename($destination);
        }

        $activeDays = $this->config['retention']['active_days'];

        $stmt = $this->pdo->prepare(
            'INSERT INTO events (uuid, booth_code, admin_id, name, logo_path, background_color,
                                  photo_cap, storage_cap_bytes, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime("now", ?))'
        );
        $stmt->execute([
            $uuid,
            $boothCode,
            (int) $_SESSION['admin_id'],
            $name,
            $logoPath,
            $backgroundColor,
            $photoCap,
            $storageCapBytes,
            "+{$activeDays} days",
        ]);

        $event = $this->findOwnedEvent((int) $this->pdo->lastInsertId());

        return $this->json($response, ['event' => $this->present($event)], 201);
    }

    /** GET /booth/config/{code} — public, no auth. Used by the booth frontend to load branding. */
    public function publicConfig(Request $request, Response $response, array $args): Response
    {
        $stmt = $this->pdo->prepare(
            "SELECT uuid, name, logo_path, background_color, status, photo_count, photo_cap,
                    storage_used_bytes, storage_cap_bytes
             FROM events WHERE booth_code = ?"
        );
        $stmt->execute([$args['code']]);
        $event = $stmt->fetch();

        if (!$event) {
            return $this->error($response, 'Unknown booth code.', 404);
        }

        // A cap of 0 means "unlimited" for that dimension (see .env.example);
        // an archived/purged event also reads as full so the booth stops
        // accepting captures once the retention cron has moved it along.
        $isFull = $event['status'] !== 'active'
            || ($event['photo_cap'] > 0 && $event['photo_count'] >= $event['photo_cap'])
            || ($event['storage_cap_bytes'] > 0 && $event['storage_used_bytes'] >= $event['storage_cap_bytes']);

        return $this->json($response, [
            'event' => [
                'uuid' => $event['uuid'],
                'name' => $event['name'],
                'logo_url' => $event['logo_path'] ? "/media/logos/{$event['uuid']}.png" : null,
                'background_color' => $event['background_color'],
                'is_full' => $isFull,
            ],
        ]);
    }

    /** Fetches an event by id, but only if it belongs to the logged-in admin — the access-control choke point for this controller. */
    private function findOwnedEvent(int $id): array|false
    {
        $stmt = $this->pdo->prepare('SELECT * FROM events WHERE id = ? AND admin_id = ?');
        $stmt->execute([$id, (int) $_SESSION['admin_id']]);
        return $stmt->fetch();
    }

    /** Keeps generating a short random code (see Uuid::boothCode()) until one isn't already in use. */
    private function generateUniqueBoothCode(): string
    {
        do {
            $code = Uuid::boothCode();
            $stmt = $this->pdo->prepare('SELECT 1 FROM events WHERE booth_code = ?');
            $stmt->execute([$code]);
        } while ($stmt->fetch());

        return $code;
    }

    /** Shapes a raw events-table row into the JSON the admin frontend expects. */
    private function present(array $event): array
    {
        return [
            'id' => (int) $event['id'],
            'uuid' => $event['uuid'],
            'booth_code' => $event['booth_code'],
            'booth_url' => "{$this->config['app']['url']}/booth/?code={$event['booth_code']}",
            'name' => $event['name'],
            'logo_url' => $event['logo_path'] ? "/media/logos/{$event['uuid']}.png" : null,
            'background_color' => $event['background_color'],
            'status' => $event['status'],
            'photo_count' => (int) $event['photo_count'],
            'photo_cap' => (int) $event['photo_cap'],
            'storage_used_bytes' => (int) $event['storage_used_bytes'],
            'storage_cap_bytes' => (int) $event['storage_cap_bytes'],
            'created_at' => $event['created_at'],
            'expires_at' => $event['expires_at'],
            'archived_at' => $event['archived_at'] ?? null,
        ];
    }
}

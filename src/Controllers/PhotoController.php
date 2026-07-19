<?php

declare(strict_types=1);

namespace Photobooth\Controllers;

use PDO;
use Photobooth\Services\{ImageService, MailService, QrCodeService, StorageService};
use Photobooth\Support\Uuid;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Everything to do with an individual photo: the guest's upload after
 * capture (upload()), streaming the file back out (media()), the "your
 * photo" page's metadata (show()), its QR code (qr()), and emailing a copy
 * (email()). Photos are addressed by an unguessable UUID rather than a
 * sequential id — that UUID *is* the access control (no login needed to
 * view/download your own photo), so never expose a route that lists all
 * photo UUIDs for an event to anyone but the event's own admin (that's
 * GalleryController, which is auth-gated).
 */
final class PhotoController extends BaseController
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly StorageService $storage,
        private readonly ImageService $images,
        private readonly QrCodeService $qr,
        private readonly MailService $mail,
        private readonly array $config,
    ) {
    }

    /** POST /booth/config/{code}/photos — guest capture upload. Body: { type, image_data_url } */
    public function upload(Request $request, Response $response, array $args): Response
    {
        $stmt = $this->pdo->prepare('SELECT * FROM events WHERE booth_code = ?');
        $stmt->execute([$args['code']]);
        $event = $stmt->fetch();

        if (!$event) {
            return $this->error($response, 'Unknown booth code.', 404);
        }
        if ($event['status'] !== 'active') {
            return $this->error($response, 'This event is no longer accepting photos.', 410);
        }

        $body = (array) $request->getParsedBody();
        $type = ($body['type'] ?? 'single') === 'strip' ? 'strip' : 'single';
        $dataUrl = (string) ($body['image_data_url'] ?? '');

        if ($dataUrl === '') {
            return $this->error($response, 'image_data_url is required.', 422);
        }

        if ($this->storage->wouldExceedEventCap(
            (int) $event['photo_count'],
            (int) $event['storage_used_bytes'],
            (int) $event['photo_cap'],
            (int) $event['storage_cap_bytes']
        )) {
            return $this->error($response, 'This event is full.', 409);
        }

        $photoUuid = Uuid::v4();
        $destination = $this->storage->photoPath($event['uuid'], $photoUuid, 'jpg');

        // ImageService decodes + re-encodes through GD before anything touches
        // disk — the uploaded data URL is never trusted/written as-is.
        try {
            $sizeBytes = $this->images->saveDataUrl($dataUrl, $destination);
        } catch (\RuntimeException $e) {
            return $this->error($response, $e->getMessage(), 422);
        }

        // Re-check under the byte count we now actually have, then persist atomically.
        if ($this->storage->wouldExceedEventCap(
            (int) $event['photo_count'],
            (int) $event['storage_used_bytes'],
            (int) $event['photo_cap'],
            (int) $event['storage_cap_bytes'],
            $sizeBytes
        )) {
            @unlink($destination);
            return $this->error($response, 'This event is full.', 409);
        }

        $insert = $this->pdo->prepare(
            'INSERT INTO photos (uuid, event_id, type, file_path, file_size_bytes) VALUES (?, ?, ?, ?, ?)'
        );
        $insert->execute([$photoUuid, (int) $event['id'], $type, basename($destination), $sizeBytes]);

        $update = $this->pdo->prepare(
            'UPDATE events SET photo_count = photo_count + 1, storage_used_bytes = storage_used_bytes + ? WHERE id = ?'
        );
        $update->execute([$sizeBytes, (int) $event['id']]);

        return $this->json($response, [
            'photo' => [
                'uuid' => $photoUuid,
                'view_url' => "/photo/?id={$photoUuid}",
                'image_url' => "/media/photos/{$photoUuid}",
            ],
        ], 201);
    }

    /** GET /media/photos/{uuid} — streams the actual image bytes. */
    public function media(Request $request, Response $response, array $args): Response
    {
        $photo = $this->findPhoto($args['uuid']);
        if (!$photo) {
            return $this->error($response, 'Photo not found.', 404);
        }

        $path = $this->storage->eventPhotosDir($photo['event_uuid']) . '/' . $photo['file_path'];
        if (!is_file($path)) {
            return $this->error($response, 'Photo file missing.', 404);
        }

        $stream = fopen($path, 'rb');
        return $response
            ->withHeader('Content-Type', 'image/jpeg')
            ->withHeader('Content-Length', (string) filesize($path))
            ->withHeader('Cache-Control', 'private, max-age=86400')
            ->withBody(new \Slim\Psr7\Stream($stream));
    }

    /** GET /api/photos/{uuid} — metadata for the guest photo view page. */
    public function show(Request $request, Response $response, array $args): Response
    {
        $photo = $this->findPhoto($args['uuid']);
        if (!$photo) {
            return $this->error($response, 'Photo not found.', 404);
        }

        return $this->json($response, [
            'photo' => [
                'uuid' => $photo['uuid'],
                'event_name' => $photo['event_name'],
                'image_url' => "/media/photos/{$photo['uuid']}",
                'created_at' => $photo['created_at'],
            ],
        ]);
    }

    /** GET /api/photos/{uuid}/qr — QR code pointing at the guest's own photo page. */
    public function qr(Request $request, Response $response, array $args): Response
    {
        $photo = $this->findPhoto($args['uuid']);
        if (!$photo) {
            return $this->error($response, 'Photo not found.', 404);
        }

        $viewUrl = "{$this->config['app']['url']}/photo/?id={$photo['uuid']}";

        return $this->json($response, ['qr_data_uri' => $this->qr->pngDataUri($viewUrl)]);
    }

    /** POST /api/photos/{uuid}/email — Body: { email } */
    public function email(Request $request, Response $response, array $args): Response
    {
        $photo = $this->findPhoto($args['uuid']);
        if (!$photo) {
            return $this->error($response, 'Photo not found.', 404);
        }

        $body = (array) $request->getParsedBody();
        $email = filter_var(trim((string) ($body['email'] ?? '')), FILTER_VALIDATE_EMAIL);
        if (!$email) {
            return $this->error($response, 'A valid email address is required.', 422);
        }

        $path = $this->storage->eventPhotosDir($photo['event_uuid']) . '/' . $photo['file_path'];
        $viewUrl = "{$this->config['app']['url']}/photo/?id={$photo['uuid']}";

        $sent = $this->mail->sendGuestPhoto($email, $photo['event_name'], $viewUrl, $path);

        $update = $this->pdo->prepare('UPDATE photos SET guest_email = ? WHERE id = ?');
        $update->execute([$email, $photo['id']]);

        return $this->json($response, ['sent' => $sent]);
    }

    /** Looks up a photo by its public UUID, joined with its event for the name/uuid the other methods need. */
    private function findPhoto(string $uuid): array|false
    {
        $stmt = $this->pdo->prepare(
            'SELECT photos.*, events.uuid AS event_uuid, events.name AS event_name
             FROM photos JOIN events ON events.id = photos.event_id
             WHERE photos.uuid = ?'
        );
        $stmt->execute([$uuid]);
        return $stmt->fetch();
    }
}

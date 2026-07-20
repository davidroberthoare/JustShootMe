<?php

declare(strict_types=1);

namespace JustShootMe\Controllers;

use JustShootMe\Services\StorageService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Psr7\Stream;

/**
 * Streams event logos out of storage/logos/ (outside the public webroot —
 * see StorageService). Photo files have their own streaming route, on
 * PhotoController::media, since they carry different access-control
 * considerations (a logo is public branding; a photo is scoped to the
 * guest who captured it via an unguessable uuid).
 */
final class MediaController extends BaseController
{
    public function __construct(private readonly StorageService $storage)
    {
    }

    /** GET /media/logos/{uuid} */
    public function logo(Request $request, Response $response, array $args): Response
    {
        // Strip any extension/path trickery from the route param before using
        // it to build a filesystem path, then validate it's actually a UUID.
        $uuid = basename((string) $args['uuid'], '.png');
        if (!preg_match('/^[0-9a-f-]{36}$/', $uuid)) {
            return $this->error($response, 'Invalid logo id.', 400);
        }

        $path = $this->storage->logoPath($uuid, 'png');
        if (!is_file($path)) {
            return $this->error($response, 'Logo not found.', 404);
        }

        $stream = fopen($path, 'rb');
        return $response
            ->withHeader('Content-Type', 'image/png')
            ->withHeader('Content-Length', (string) filesize($path))
            ->withHeader('Cache-Control', 'public, max-age=86400')
            ->withBody(new Stream($stream));
    }
}

<?php

declare(strict_types=1);

namespace Photobooth\Controllers;

use Photobooth\Services\StorageService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Psr7\Stream;

final class MediaController extends BaseController
{
    public function __construct(private readonly StorageService $storage)
    {
    }

    /** GET /media/logos/{uuid}.png */
    public function logo(Request $request, Response $response, array $args): Response
    {
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

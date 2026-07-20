<?php

declare(strict_types=1);

use JustShootMe\Controllers\{
    ArchiveController,
    AuthController,
    EventController,
    GalleryController,
    MediaController,
    PhotoController
};
use JustShootMe\Middleware\AdminAuthMiddleware;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\App;

/** @var App $app */

$app->get('/api/health', function (Request $request, Response $response) {
    $response->getBody()->write(json_encode(['ok' => true]));
    return $response->withHeader('Content-Type', 'application/json');
});

// --- Admin auth -----------------------------------------------------------
$app->post('/api/admin/login', [AuthController::class, 'login']);
$app->post('/api/admin/logout', [AuthController::class, 'logout']);
$app->get('/api/admin/me', [AuthController::class, 'me']);

// --- Admin: events & gallery (session-protected) ---------------------------
$app->group('/api/admin', function ($group) {
    $group->get('/events', [EventController::class, 'index']);
    $group->post('/events', [EventController::class, 'create']);
    $group->get('/events/{id}', [EventController::class, 'show']);
    // POST, not PATCH: PHP doesn't populate $_FILES/parsed-body for
    // multipart PATCH requests, and this update may include a logo file.
    $group->post('/events/{id}', [EventController::class, 'update']);
    $group->delete('/events/{id}', [EventController::class, 'destroy']);
    $group->get('/events/{id}/photos', [GalleryController::class, 'index']);
    $group->get('/events/{id}/download', [GalleryController::class, 'download']);
})->add(AdminAuthMiddleware::class);

// --- Booth (public, keyed by short booth code) ------------------------------
$app->get('/booth/config/{code}', [EventController::class, 'publicConfig']);
$app->post('/booth/config/{code}/photos', [PhotoController::class, 'upload']);

// --- Guest photo (public, keyed by unguessable photo uuid) ------------------
$app->get('/api/photos/{uuid}', [PhotoController::class, 'show']);
$app->get('/api/photos/{uuid}/qr', [PhotoController::class, 'qr']);
$app->post('/api/photos/{uuid}/email', [PhotoController::class, 'email']);

// --- Media (file streaming out of storage/, outside the public webroot) ----
$app->get('/media/photos/{uuid}', [PhotoController::class, 'media']);
$app->get('/media/logos/{uuid}', [MediaController::class, 'logo']);

// --- Archive download (stage-3 retention, signed & expiring) ---------------
$app->get('/archive/{eventId}/download', [ArchiveController::class, 'download']);

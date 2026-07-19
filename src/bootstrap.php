<?php

declare(strict_types=1);

use DI\Container;
use Photobooth\Controllers\{
    ArchiveController,
    AuthController,
    EventController,
    GalleryController,
    MediaController,
    PhotoController
};
use Photobooth\Middleware\AdminAuthMiddleware;
use Photobooth\Services\{ImageService, MailService, QrCodeService, SignedUrlService, StorageService};
use Photobooth\Support\{Config, Database};
use Slim\App;
use Slim\Factory\AppFactory;

/*
 * Application bootstrap: loads config, wires the DI container (php-di) with
 * every service/controller/middleware the routes need, and returns a ready
 * Slim App. Included once by public/index.php, before src/routes.php
 * registers the actual routes on it.
 */

require_once __DIR__ . '/../vendor/autoload.php';

$rootPath = dirname(__DIR__);
$config = Config::load($rootPath);

$container = new Container();

$container->set('config', $config);

$container->set(PDO::class, static fn () => Database::connect($config));

$container->set(StorageService::class, static fn () => new StorageService(
    $config['storage']['events_path'],
    $config['storage']['archives_path'],
    $config['storage']['logos_path'],
    $config['limits']['global_storage_cap_bytes'],
));

$container->set(ImageService::class, static fn () => new ImageService());

$container->set(QrCodeService::class, static fn () => new QrCodeService());

$container->set(MailService::class, static fn () => new MailService($config['mail']));

$container->set(SignedUrlService::class, static fn () => new SignedUrlService(
    $config['app']['secret'],
    $config['app']['url'],
));

// Controllers/middleware take typed services plus the raw config array, which
// php-di can't autowire on its own — wire them explicitly here.
$container->set(AdminAuthMiddleware::class, static fn () => new AdminAuthMiddleware(
    new \Slim\Psr7\Factory\ResponseFactory()
));

$container->set(AuthController::class, static fn ($c) => new AuthController($c->get(PDO::class)));

$container->set(EventController::class, static fn ($c) => new EventController(
    $c->get(PDO::class),
    $c->get(StorageService::class),
    $c->get(ImageService::class),
    $config,
));

$container->set(PhotoController::class, static fn ($c) => new PhotoController(
    $c->get(PDO::class),
    $c->get(StorageService::class),
    $c->get(ImageService::class),
    $c->get(QrCodeService::class),
    $c->get(MailService::class),
    $config,
));

$container->set(GalleryController::class, static fn ($c) => new GalleryController(
    $c->get(PDO::class),
    $c->get(StorageService::class),
));

$container->set(ArchiveController::class, static fn ($c) => new ArchiveController(
    $c->get(PDO::class),
    $c->get(StorageService::class),
    $c->get(SignedUrlService::class),
    $config,
));

$container->set(MediaController::class, static fn ($c) => new MediaController($c->get(StorageService::class)));

AppFactory::setContainer($container);
$app = AppFactory::create();

$app->addBodyParsingMiddleware();

$app->addErrorMiddleware((bool) $config['app']['debug'], true, true);

return $app;

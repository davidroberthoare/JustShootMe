<?php

declare(strict_types=1);

session_start([
    'cookie_httponly' => true,
    'cookie_samesite' => 'Lax',
]);

/** @var \Slim\App $app */
$app = require_once __DIR__ . '/../src/bootstrap.php';

require_once __DIR__ . '/../src/routes.php';

$app->run();

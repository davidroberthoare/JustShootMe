<?php
// Router for `php -S` during local development only.
// Usage: php -S localhost:8080 -t public public/router.php

$path = urldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
$file = __DIR__ . $path;

if ($path !== '/' && is_file($file)) {
    return false; // serve the requested static file as-is
}

if (is_dir($file) && is_file(rtrim($file, '/') . '/index.html')) {
    return false; // let the built-in server's default handler serve dir/index.html
}

require __DIR__ . '/index.php';

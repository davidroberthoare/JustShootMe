<?php
// Router for `php -S` during local development only.
// Usage: php -S localhost:8080 -t public public/router.php

$path = urldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
$file = __DIR__ . $path;

if ($path !== '/' && is_file($file)) {
    return false; // serve the requested static file as-is
}

if (is_dir($file) && is_file(rtrim($file, '/') . '/index.html')) {
    // Serve it directly rather than `return false`: the built-in server's
    // own directory-index fallback prefers index.php over index.html, which
    // at the docroot itself (both files exist side by side — index.html is
    // the kiosk landing page, index.php is the Slim front controller) would
    // silently route "/" into Slim's 404 handler instead of the landing page.
    header('Content-Type: text/html; charset=UTF-8');
    readfile(rtrim($file, '/') . '/index.html');
    return true;
}

require __DIR__ . '/index.php';

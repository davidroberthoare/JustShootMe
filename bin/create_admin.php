<?php

declare(strict_types=1);

/**
 * Usage: php bin/create_admin.php admin@example.com 'a-strong-password'
 * Creates (or updates the password of) an admin account.
 */

use Photobooth\Support\{Config, Database};

require_once __DIR__ . '/../vendor/autoload.php';

[, $email, $password] = array_pad($argv, 3, null);

if (!$email || !$password) {
    fwrite(STDERR, "Usage: php bin/create_admin.php <email> <password>\n");
    exit(1);
}

if (strlen($password) < 8) {
    fwrite(STDERR, "Password must be at least 8 characters.\n");
    exit(1);
}

$rootPath = dirname(__DIR__);
$config = Config::load($rootPath);
$pdo = Database::connect($config);

$hash = password_hash($password, PASSWORD_DEFAULT);

$stmt = $pdo->prepare('SELECT id FROM admins WHERE email = ?');
$stmt->execute([$email]);

if ($existing = $stmt->fetch()) {
    $update = $pdo->prepare('UPDATE admins SET password_hash = ? WHERE id = ?');
    $update->execute([$hash, $existing['id']]);
    echo "Updated password for {$email}.\n";
} else {
    $insert = $pdo->prepare('INSERT INTO admins (email, password_hash) VALUES (?, ?)');
    $insert->execute([$email, $hash]);
    echo "Created admin {$email}.\n";
}

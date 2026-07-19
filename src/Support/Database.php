<?php

declare(strict_types=1);

namespace Photobooth\Support;

use PDO;

final class Database
{
    public static function connect(array $config): PDO
    {
        $dbPath = $config['db']['path'];
        $dbDir = dirname($dbPath);
        if (!is_dir($dbDir)) {
            mkdir($dbDir, 0775, true);
        }

        $isNew = !is_file($dbPath);

        $pdo = new PDO('sqlite:' . $dbPath);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA journal_mode = WAL');

        if ($isNew) {
            self::migrate($pdo, $config['root_path']);
        }

        return $pdo;
    }

    public static function migrate(PDO $pdo, string $rootPath): void
    {
        $schema = file_get_contents($rootPath . '/database/schema.sql');
        $pdo->exec($schema);
    }
}

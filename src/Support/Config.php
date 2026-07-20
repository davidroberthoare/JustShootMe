<?php

declare(strict_types=1);

namespace JustShootMe\Support;

/**
 * Thin typed wrapper around environment variables loaded by phpdotenv.
 * Centralizes the config surface so the rest of the app never reads $_ENV directly.
 */
final class Config
{
    private static ?array $cache = null;

    public static function load(string $rootPath): array
    {
        if (self::$cache !== null) {
            return self::$cache;
        }

        if (is_file($rootPath . '/.env')) {
            $dotenv = \Dotenv\Dotenv::createImmutable($rootPath);
            $dotenv->load();
        }

        $bool = static fn (string $key, bool $default) => filter_var(
            $_ENV[$key] ?? $default,
            FILTER_VALIDATE_BOOLEAN
        );
        $int = static fn (string $key, int $default) => (int) ($_ENV[$key] ?? $default);
        $str = static fn (string $key, string $default = '') => (string) ($_ENV[$key] ?? $default);

        self::$cache = [
            'root_path' => $rootPath,
            'app' => [
                'env' => $str('APP_ENV', 'production'),
                'debug' => $bool('APP_DEBUG', false),
                'url' => rtrim($str('APP_URL', 'http://localhost:8080'), '/'),
                'secret' => $str('APP_SECRET', ''),
            ],
            'db' => [
                'path' => $rootPath . '/' . ltrim($str('DB_PATH', 'storage/justshootme.sqlite'), '/'),
            ],
            'storage' => [
                'events_path' => $rootPath . '/' . ltrim($str('STORAGE_EVENTS_PATH', 'storage/events'), '/'),
                'archives_path' => $rootPath . '/' . ltrim($str('STORAGE_ARCHIVES_PATH', 'storage/archives'), '/'),
                'logos_path' => $rootPath . '/' . ltrim($str('STORAGE_LOGOS_PATH', 'storage/logos'), '/'),
            ],
            'mail' => [
                'host' => $str('SES_SMTP_HOST'),
                'port' => $int('SES_SMTP_PORT', 587),
                'username' => $str('SES_SMTP_USERNAME'),
                'password' => $str('SES_SMTP_PASSWORD'),
                'from_email' => $str('SES_FROM_EMAIL'),
                'from_name' => $str('SES_FROM_NAME', 'JustShootMe'),
            ],
            'retention' => [
                'active_days' => $int('RETENTION_ACTIVE_DAYS', 7),
                'archive_days' => $int('RETENTION_ARCHIVE_DAYS', 7),
                'download_grace_hours' => $int('RETENTION_DOWNLOAD_GRACE_HOURS', 1),
            ],
            'limits' => [
                'default_event_photo_cap' => $int('DEFAULT_EVENT_PHOTO_CAP', 200),
                'default_event_storage_cap_bytes' => $int('DEFAULT_EVENT_STORAGE_CAP_MB', 500) * 1024 * 1024,
                'global_storage_cap_bytes' => $int('GLOBAL_STORAGE_CAP_MB', 0) * 1024 * 1024,
            ],
        ];

        return self::$cache;
    }

    public static function get(string $dottedKey, mixed $default = null): mixed
    {
        $segments = explode('.', $dottedKey);
        $value = self::$cache;
        foreach ($segments as $segment) {
            if (!is_array($value) || !array_key_exists($segment, $value)) {
                return $default;
            }
            $value = $value[$segment];
        }
        return $value;
    }
}

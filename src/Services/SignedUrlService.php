<?php

declare(strict_types=1);

namespace Photobooth\Services;

/**
 * HMAC-signed, expiring URLs for archive downloads (spec: "signed/expiring
 * download link, not a guessable static URL").
 */
final class SignedUrlService
{
    public function __construct(private readonly string $secret, private readonly string $appUrl)
    {
    }

    public function makeArchiveDownloadUrl(int $eventId, string $eventUuid, int $ttlSeconds): string
    {
        $expires = time() + $ttlSeconds;
        $signature = $this->sign($eventUuid, $expires);

        $query = http_build_query([
            'event' => $eventUuid,
            'expires' => $expires,
            'sig' => $signature,
        ]);

        return "{$this->appUrl}/archive/{$eventId}/download?{$query}";
    }

    public function verify(string $eventUuid, int $expires, string $signature): bool
    {
        if ($expires < time()) {
            return false;
        }

        $expected = $this->sign($eventUuid, $expires);
        return hash_equals($expected, $signature);
    }

    private function sign(string $eventUuid, int $expires): string
    {
        return hash_hmac('sha256', $eventUuid . '|' . $expires, $this->secret);
    }
}

<?php

declare(strict_types=1);

namespace JustShootMe\Support;

/** Id generation: proper UUIDv4s for internal record ids (events, photos), plus a short human-typeable code for booth URLs. */
final class Uuid
{
    /** Standard RFC 4122 UUIDv4 (e.g. event/photo primary identifiers). */
    public static function v4(): string
    {
        $data = random_bytes(16);
        $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
        $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);

        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }

    /** Short, human-typeable code for booth URLs, e.g. "7F3K-9QRT". */
    public static function boothCode(): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
        $chars = '';
        for ($i = 0; $i < 8; $i++) {
            $chars .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        return substr($chars, 0, 4) . '-' . substr($chars, 4, 4);
    }
}

<?php

declare(strict_types=1);

namespace Photobooth\Services;

use chillerlan\QRCode\{QRCode, QROptions};
use chillerlan\QRCode\Output\QROutputInterface;

/**
 * Thin wrapper around chillerlan/php-qrcode. Used by PhotoController to
 * generate a QR code pointing guests at their own /photo/?id={uuid} page —
 * generated on the fly, nothing is cached to disk.
 */
final class QrCodeService
{
    /** Returns a PNG data URI ("data:image/png;base64,...") for the given URL, ready to drop into an <img src>. */
    public function pngDataUri(string $url): string
    {
        $options = new QROptions([
            'outputType' => QROutputInterface::GDIMAGE_PNG,
            'scale' => 6,
            'imageBase64' => true,
        ]);

        return (new QRCode($options))->render($url);
    }
}

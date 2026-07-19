<?php

declare(strict_types=1);

namespace Photobooth\Services;

use chillerlan\QRCode\{QRCode, QROptions};
use chillerlan\QRCode\Output\QROutputInterface;

final class QrCodeService
{
    /** Returns a PNG data URI ("data:image/png;base64,...") for the given URL. */
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

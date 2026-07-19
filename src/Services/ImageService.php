<?php

declare(strict_types=1);

namespace Photobooth\Services;

use RuntimeException;

/**
 * Branding (logo + background colour) is composited client-side on the
 * booth's <canvas> before upload, per spec. Server-side we never trust the
 * uploaded bytes directly: every image is decoded and re-encoded through GD
 * before it touches disk, which validates it's really an image and strips
 * anything else (EXIF, polyglot payloads, etc.) riding along in the file.
 */
final class ImageService
{
    private const MAX_DECODED_BYTES = 25 * 1024 * 1024;

    public function saveDataUrl(string $dataUrl, string $destinationPath): int
    {
        if (!preg_match('/^data:image\/(png|jpe?g);base64,(.+)$/', $dataUrl, $matches)) {
            throw new RuntimeException('Unsupported image data URL.');
        }

        $binary = base64_decode($matches[2], true);
        if ($binary === false || $binary === '') {
            throw new RuntimeException('Could not decode image data.');
        }
        if (strlen($binary) > self::MAX_DECODED_BYTES) {
            throw new RuntimeException('Image exceeds maximum allowed size.');
        }

        $image = @imagecreatefromstring($binary);
        if ($image === false) {
            throw new RuntimeException('Uploaded data is not a valid image.');
        }

        imageinterlace($image, true); // progressive JPEG for faster perceived load
        $ok = imagejpeg($image, $destinationPath, 90);
        imagedestroy($image);

        if (!$ok) {
            throw new RuntimeException('Failed to write image to disk.');
        }

        return filesize($destinationPath) ?: 0;
    }

    /** Re-encodes an uploaded logo file to PNG (preserving transparency) at $destinationPath. */
    public function saveUploadedLogo(string $tmpUploadPath, string $destinationPath): int
    {
        $info = @getimagesize($tmpUploadPath);
        if ($info === false) {
            throw new RuntimeException('Uploaded logo is not a valid image.');
        }

        $image = @imagecreatefromstring((string) file_get_contents($tmpUploadPath));
        if ($image === false) {
            throw new RuntimeException('Could not decode uploaded logo.');
        }

        imagesavealpha($image, true);
        $ok = imagepng($image, $destinationPath, 6);
        imagedestroy($image);

        if (!$ok) {
            throw new RuntimeException('Failed to write logo to disk.');
        }

        return filesize($destinationPath) ?: 0;
    }
}

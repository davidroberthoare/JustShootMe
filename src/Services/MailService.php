<?php

declare(strict_types=1);

namespace JustShootMe\Services;

use PHPMailer\PHPMailer\PHPMailer;

/**
 * Sends mail through the Amazon SES SMTP interface. Swapping to the SES API
 * later just means replacing the internals of send(); callers are unaffected.
 */
final class MailService
{
    public function __construct(private readonly array $config)
    {
    }

    public function send(string $toEmail, string $subject, string $htmlBody, array $attachments = []): bool
    {
        $mail = new PHPMailer(true);

        $mail->isSMTP();
        $mail->Host = $this->config['host'];
        $mail->Port = $this->config['port'];
        $mail->SMTPAuth = true;
        $mail->Username = $this->config['username'];
        $mail->Password = $this->config['password'];
        $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Timeout = 15; // don't let an unreachable SMTP host hang the retention cron indefinitely
        $mail->SMTPKeepAlive = false;

        $mail->setFrom($this->config['from_email'], $this->config['from_name']);
        $mail->addAddress($toEmail);

        $mail->isHTML(true);
        $mail->Subject = $subject;
        $mail->Body = $htmlBody;
        $mail->AltBody = strip_tags($htmlBody);

        foreach ($attachments as $attachment) {
            $mail->addAttachment($attachment['path'], $attachment['name'] ?? '');
        }

        return $mail->send();
    }

    public function sendGuestPhoto(string $toEmail, string $eventName, string $photoUrl, string $photoPath): bool
    {
        $html = sprintf(
            '<p>Here\'s your photo from <strong>%s</strong>!</p><p><a href="%s">View or download it here</a>.</p>',
            htmlspecialchars($eventName, ENT_QUOTES),
            htmlspecialchars($photoUrl, ENT_QUOTES)
        );

        return $this->send($toEmail, "Your photo from {$eventName}", $html, [
            ['path' => $photoPath, 'name' => basename($photoPath)],
        ]);
    }

    public function sendArchiveReadyNotice(string $toEmail, string $eventName, string $downloadUrl, int $expiresInDays): bool
    {
        $html = sprintf(
            '<p>Your event <strong>%s</strong> has ended and its photos have been archived.</p>'
            . '<p><a href="%s">Download your archive</a> within %d days before it is permanently deleted.</p>',
            htmlspecialchars($eventName, ENT_QUOTES),
            htmlspecialchars($downloadUrl, ENT_QUOTES),
            $expiresInDays
        );

        return $this->send($toEmail, "Your event archive is ready: {$eventName}", $html);
    }

    public function sendArchiveExpiringReminder(string $toEmail, string $eventName, string $downloadUrl, int $daysLeft): bool
    {
        $html = sprintf(
            '<p>Reminder: the archive for <strong>%s</strong> will be permanently deleted in %d day(s).</p>'
            . '<p><a href="%s">Download it now</a> if you haven\'t already.</p>',
            htmlspecialchars($eventName, ENT_QUOTES),
            $daysLeft,
            htmlspecialchars($downloadUrl, ENT_QUOTES)
        );

        return $this->send($toEmail, "Reminder: archive for {$eventName} expires soon", $html);
    }
}

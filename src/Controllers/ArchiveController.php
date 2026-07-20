<?php

declare(strict_types=1);

namespace JustShootMe\Controllers;

use PDO;
use JustShootMe\Services\{SignedUrlService, StorageService};
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Streams stage-3 (archived) event zips via signed, expiring links (spec:
 * "signed/expiring download link, not a guessable static URL"). Deletion is
 * NOT immediate on a successful download — see retention_cron.php, which
 * sweeps anything past archive_purge_after. This lets a flaky connection
 * retry without risking the admin's only copy being deleted mid-transfer.
 */
final class ArchiveController extends BaseController
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly StorageService $storage,
        private readonly SignedUrlService $signedUrls,
        private readonly array $config,
    ) {
    }

    /** GET /archive/{eventId}/download?event={uuid}&expires={ts}&sig={hmac} */
    public function download(Request $request, Response $response, array $args): Response
    {
        $query = $request->getQueryParams();
        $eventUuid = (string) ($query['event'] ?? '');
        $expires = (int) ($query['expires'] ?? 0);
        $signature = (string) ($query['sig'] ?? '');

        if (!$this->signedUrls->verify($eventUuid, $expires, $signature)) {
            return $this->error($response, 'This download link is invalid or has expired.', 403);
        }

        $stmt = $this->pdo->prepare('SELECT * FROM events WHERE id = ? AND uuid = ?');
        $stmt->execute([(int) $args['eventId'], $eventUuid]);
        $event = $stmt->fetch();

        if (!$event || $event['status'] !== 'archived' || !$event['archive_path']) {
            return $this->error($response, 'Archive not found.', 404);
        }

        $path = $this->storage->archivePath($event['uuid']);
        if (!is_file($path)) {
            return $this->error($response, 'Archive file is missing.', 404);
        }

        $filename = preg_replace('/[^a-zA-Z0-9_-]+/', '-', $event['name']) . '-archive.zip';

        // Deliberately raw PHP here (spec requirement): readfile() rather than a
        // stream response, so we can check connection_aborted() the instant after
        // the transfer finishes and only then mark the archive downloaded.
        while (ob_get_level() > 0) {
            ob_end_clean();
        }

        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . filesize($path));
        header('Cache-Control: no-store');

        readfile($path);

        $graceHours = $this->config['retention']['download_grace_hours'];
        if (!connection_aborted()) {
            $update = $this->pdo->prepare(
                'UPDATE events SET archive_downloaded_at = datetime("now"),
                                    archive_purge_after = datetime("now", ?)
                 WHERE id = ?'
            );
            $update->execute(["+{$graceHours} hours", $event['id']]);
        }

        exit;
    }
}

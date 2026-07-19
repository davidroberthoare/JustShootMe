<?php

declare(strict_types=1);

namespace Photobooth\Controllers;

use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Admin login/logout/session-check. Auth is a plain PHP session cookie set
 * on successful login (see AdminAuthMiddleware for how it's enforced on
 * protected routes) — no tokens, no third-party auth provider. See the
 * README's "Open items from the spec" section for why this was chosen and
 * how to swap it for something stronger later without touching anything
 * else.
 */
final class AuthController extends BaseController
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /** POST /api/admin/login — verifies email+password, starts a session. */
    public function login(Request $request, Response $response): Response
    {
        $body = (array) $request->getParsedBody();
        $email = trim((string) ($body['email'] ?? ''));
        $password = (string) ($body['password'] ?? '');

        if ($email === '' || $password === '') {
            return $this->error($response, 'Email and password are required.', 422);
        }

        $stmt = $this->pdo->prepare('SELECT id, password_hash FROM admins WHERE email = ?');
        $stmt->execute([$email]);
        $admin = $stmt->fetch();

        if (!$admin || !password_verify($password, $admin['password_hash'])) {
            return $this->error($response, 'Invalid credentials.', 401);
        }

        // Regenerate the session id on privilege change (login) to prevent session fixation.
        session_regenerate_id(true);
        $_SESSION['admin_id'] = (int) $admin['id'];
        $_SESSION['admin_email'] = $email;

        return $this->json($response, ['id' => (int) $admin['id'], 'email' => $email]);
    }

    /** POST /api/admin/logout — clears the session. */
    public function logout(Request $request, Response $response): Response
    {
        $_SESSION = [];
        session_destroy();
        return $this->json($response, ['ok' => true]);
    }

    /** GET /api/admin/me — used by admin.js on page load to decide login vs. dashboard. */
    public function me(Request $request, Response $response): Response
    {
        if (empty($_SESSION['admin_id'])) {
            return $this->error($response, 'Not authenticated', 401);
        }
        return $this->json($response, [
            'id' => (int) $_SESSION['admin_id'],
            'email' => $_SESSION['admin_email'] ?? null,
        ]);
    }
}

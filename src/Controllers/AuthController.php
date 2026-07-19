<?php

declare(strict_types=1);

namespace Photobooth\Controllers;

use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

final class AuthController extends BaseController
{
    public function __construct(private readonly PDO $pdo)
    {
    }

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

        session_regenerate_id(true);
        $_SESSION['admin_id'] = (int) $admin['id'];
        $_SESSION['admin_email'] = $email;

        return $this->json($response, ['id' => (int) $admin['id'], 'email' => $email]);
    }

    public function logout(Request $request, Response $response): Response
    {
        $_SESSION = [];
        session_destroy();
        return $this->json($response, ['ok' => true]);
    }

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

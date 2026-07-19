<?php

declare(strict_types=1);

namespace Photobooth\Middleware;

use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface as Handler;

/**
 * Gatekeeper for the /api/admin/* route group (see routes.php). Rejects the
 * request with 401 before it ever reaches the controller if there's no
 * logged-in admin session (set by AuthController::login). Session_start()
 * itself happens once in public/index.php, before routing.
 */
final class AdminAuthMiddleware implements MiddlewareInterface
{
    public function __construct(private readonly ResponseFactoryInterface $responseFactory)
    {
    }

    public function process(Request $request, Handler $handler): Response
    {
        if (empty($_SESSION['admin_id'])) {
            $response = $this->responseFactory->createResponse(401);
            $response->getBody()->write(json_encode(['error' => 'Not authenticated']));
            return $response->withHeader('Content-Type', 'application/json');
        }

        return $handler->handle($request);
    }
}

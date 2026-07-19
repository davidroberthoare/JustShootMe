<?php

declare(strict_types=1);

namespace Photobooth\Controllers;

use Psr\Http\Message\ResponseInterface as Response;

/**
 * Shared helpers for every controller. All API responses in this app are
 * JSON, so every route handler ends by calling json() or error() rather
 * than building a Response by hand.
 */
abstract class BaseController
{
    /** Writes $data as a JSON body and sets the Content-Type header. */
    protected function json(Response $response, mixed $data, int $status = 200): Response
    {
        $response->getBody()->write((string) json_encode($data, JSON_UNESCAPED_SLASHES));
        return $response->withHeader('Content-Type', 'application/json')->withStatus($status);
    }

    /** Shorthand for json(['error' => $message], $status) — the shape every failed API call returns. */
    protected function error(Response $response, string $message, int $status = 400): Response
    {
        return $this->json($response, ['error' => $message], $status);
    }
}

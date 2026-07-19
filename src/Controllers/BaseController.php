<?php

declare(strict_types=1);

namespace Photobooth\Controllers;

use Psr\Http\Message\ResponseInterface as Response;

abstract class BaseController
{
    protected function json(Response $response, mixed $data, int $status = 200): Response
    {
        $response->getBody()->write((string) json_encode($data, JSON_UNESCAPED_SLASHES));
        return $response->withHeader('Content-Type', 'application/json')->withStatus($status);
    }

    protected function error(Response $response, string $message, int $status = 400): Response
    {
        return $this->json($response, ['error' => $message], $status);
    }
}

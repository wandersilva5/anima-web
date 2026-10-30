<?php
declare(strict_types=1);

final class Router
{
    /** @var list<array{method:string,pattern:string,handler:callable}> */
    private array $routes = [];

    public function add(string $method, string $pattern, callable $handler): void
    {
        $this->routes[] = ['method' => strtoupper($method), 'pattern' => $pattern, 'handler' => $handler];
    }

    public function dispatch(string $method, string $path): void
    {
        $allowed = [];

        foreach ($this->routes as $route) {
            if (preg_match($route['pattern'], $path, $matches) !== 1) {
                continue;
            }
            if ($route['method'] !== $method) {
                $allowed[] = $route['method'];
                continue;
            }
            $params = array_filter($matches, static fn ($key) => is_string($key), ARRAY_FILTER_USE_KEY);
            ($route['handler'])($params);
            return;
        }

        if ($allowed !== []) {
            header('Allow: ' . implode(', ', array_unique($allowed)));
            Http::error('method_not_allowed', 'Metodo nao permitido.', 405);
        }

        Http::error('not_found', 'Rota nao encontrada: ' . $path, 404);
    }
}

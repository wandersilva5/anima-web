<?php
declare(strict_types=1);

final class Http
{
    public static function json(mixed $data, int $status = 200): never
    {
        if (!headers_sent()) {
            http_response_code($status);
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: no-store');
            header('X-Content-Type-Options: nosniff');
        }
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function error(string $code, string $message, int $status = 400): never
    {
        self::json(['error' => ['code' => $code, 'message' => $message]], $status);
    }

    /** @return array<string,mixed> */
    public static function jsonBody(): array
    {
        $raw = file_get_contents('php://input') ?: '';
        if (trim($raw) === '') {
            return [];
        }
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            self::error('invalid_json', 'JSON invalido no corpo da requisicao.', 400);
        }
        return $data;
    }

    public static function query(string $key, ?string $default = null): ?string
    {
        $value = $_GET[$key] ?? null;
        if ($value === null || $value === '') {
            return $default;
        }
        return is_string($value) ? trim($value) : $default;
    }

    public static function queryInt(string $key, int $default, int $min, int $max): int
    {
        $value = self::query($key);
        if ($value === null) {
            return $default;
        }
        $int = (int) $value;
        return max($min, min($max, $int));
    }

    /** @return list<string> */
    public static function queryList(string $key): array
    {
        $value = self::query($key);
        if ($value === null) {
            return [];
        }
        $parts = array_map('trim', explode(',', $value));
        return array_values(array_filter($parts, static fn ($p) => $p !== ''));
    }

    public static function method(): string
    {
        return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    }

    public static function requireMethod(string ...$methods): void
    {
        if (!in_array(self::method(), $methods, true)) {
            header('Allow: ' . implode(', ', $methods));
            self::error('method_not_allowed', 'Metodo nao permitido.', 405);
        }
    }

    public static function clientIp(): string
    {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '';
        return is_string($ip) ? substr($ip, 0, 45) : '';
    }

    public static function isHttps(): bool
    {
        $https = strtolower((string) ($_SERVER['HTTPS'] ?? ''));
        $forwarded = strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
        return $https === 'on' || $https === '1' || $forwarded === 'https';
    }

    public static function header(string $name): ?string
    {
        $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
        $value = $_SERVER[$key] ?? null;
        return is_string($value) ? $value : null;
    }
}

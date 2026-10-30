<?php
declare(strict_types=1);

require_once __DIR__ . '/Config.php';
Config::load();

date_default_timezone_set('America/Sao_Paulo');
mb_internal_encoding('UTF-8');

spl_autoload_register(static function (string $class): void {
    $file = __DIR__ . '/' . str_replace('\\', '/', $class) . '.php';
    if (is_file($file)) {
        require_once $file;
    }
});

function app_log(string $level, string $message, array $context = []): void
{
    try {
        $dir = Config::storagePath('logs');
        Config::ensureDir($dir);
        $line = sprintf(
            "[%s] %s %s%s\n",
            date('Y-m-d H:i:s'),
            strtoupper($level),
            $message,
            $context === [] ? '' : ' ' . json_encode($context, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        );
        file_put_contents($dir . '/app-' . date('Y-m') . '.log', $line, FILE_APPEND | LOCK_EX);
    } catch (Throwable) {
        // log nunca deve derrubar a requisicao
    }
}

if (Config::get('APP_ENV', 'local') !== 'local') {
    ini_set('display_errors', '0');
} else {
    ini_set('display_errors', '1');
}

set_exception_handler(static function (Throwable $e): void {
    app_log('error', $e->getMessage(), [
        'file' => $e->getFile() . ':' . $e->getLine(),
        'uri' => $_SERVER['REQUEST_URI'] ?? '',
        'method' => $_SERVER['REQUEST_METHOD'] ?? '',
    ]);

    if (PHP_SAPI === 'cli') {
        fwrite(STDERR, 'ERRO: ' . $e->getMessage() . PHP_EOL);
        exit(1);
    }

    $debug = Config::get('APP_ENV', 'local') === 'local';
    Http::json([
        'error' => [
            'code' => 'server_error',
            'message' => $debug ? $e->getMessage() : 'Erro interno. Tente novamente.',
        ],
    ], 500);
});

set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false;
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

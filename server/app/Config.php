<?php
declare(strict_types=1);

/**
 * Configuracao central: carrega server/.env e resolve caminhos.
 *
 * Layout local:            Layout Hostinger:
 *   server/                  ~/anima/            (fora do docroot)
 *     app/                     app/
 *     db/                      db/
 *     storage/                 storage/
 *     public/                  public_html/galeria/
 */
final class Config
{
    private static array $values = [];
    private static bool $loaded = false;

    public static function load(?string $envFile = null): void
    {
        if (self::$loaded) {
            return;
        }

        $root = dirname(__DIR__); // server/
        $envFile = $envFile ?? $root . '/.env';
        if (is_file($envFile)) {
            foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
                $line = trim($line);
                if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
                    continue;
                }
                [$key, $value] = explode('=', $line, 2);
                $key = trim($key);
                $value = trim($value);
                if (strlen($value) > 1) {
                    $first = $value[0];
                    $last = $value[strlen($value) - 1];
                    if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
                        $value = substr($value, 1, -1);
                    }
                }
                self::$values[$key] = $value;
            }
        }

        self::$values['_ROOT'] = $root;
        self::$loaded = true;
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        self::load();
        $value = self::$values[$key] ?? null;
        return ($value === null || $value === '') ? $default : $value;
    }

    public static function int(string $key, int $default): int
    {
        $value = self::get($key);
        return $value === null ? $default : (int) $value;
    }

    public static function bool(string $key, bool $default = false): bool
    {
        $value = self::get($key);
        if ($value === null) {
            return $default;
        }
        return in_array(strtolower($value), ['1', 'true', 'yes', 'on'], true);
    }

    public static function root(): string
    {
        return self::get('_ROOT') ?? dirname(__DIR__);
    }

    /** Arquivo/diretorio dentro de server/ (codigo, storage, db). */
    public static function path(string $sub = ''): string
    {
        return self::root() . ($sub === '' ? '' : '/' . ltrim($sub, '/'));
    }

    /** Diretorio publico servido pelo Apache (public/). */
    public static function publicPath(string $sub = ''): string
    {
        return self::path('public' . ($sub === '' ? '' : '/' . ltrim($sub, '/')));
    }

    public static function storagePath(string $sub = ''): string
    {
        $base = self::get('STORAGE_DIR') ?: self::path('storage');
        return rtrim($base, '/') . ($sub === '' ? '' : '/' . ltrim($sub, '/'));
    }

    public static function mediaPath(string $sub = ''): string
    {
        $base = self::get('MEDIA_DIR') ?: self::publicPath('media');
        return rtrim($base, '/') . ($sub === '' ? '' : '/' . ltrim($sub, '/'));
    }

    /** Caminho publico (URL) de uma midia, sempre a partir da raiz do site. */
    public static function mediaUrl(string $relative): string
    {
        $base = self::get('MEDIA_URL');

        if ($base === null) {
            $base = self::basePath() . '/media';
        } elseif (!preg_match('#^(?:[a-z]+:)?//#i', $base) && $base[0] !== '/') {
            // valor relativo no .env: ancora no caminho da aplicacao (subpasta ou raiz)
            $base = self::basePath() . '/' . $base;
        }

        return rtrim($base, '/') . '/' . ltrim($relative, '/');
    }

    /**
     * Subpasta em que o site esta instalado ('' quando e a raiz do dominio).
     * Necessario porque superficies como /i/<uuid> quebram URLs relativas.
     */
    public static function basePath(): string
    {
        $script = $_SERVER['SCRIPT_NAME'] ?? '/index.php';
        $dir = rtrim(str_replace('\\', '/', dirname($script)), '/');
        return ($dir === '' || $dir === '.' || $dir === '/') ? '' : $dir;
    }

    public static function ensureDir(string $dir): void
    {
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new RuntimeException('Nao foi possivel criar o diretorio: ' . $dir);
        }
    }
}

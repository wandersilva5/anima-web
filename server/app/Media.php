<?php
declare(strict_types=1);

/**
 * Armazenamento das imagens: original + derivadas (display e thumbnail).
 * Layout: media/{o,d,t}/aa/bb/<sha256>.<ext>
 */
final class Media
{
    public const DISPLAY_MAX = 1440;
    public const THUMB_MAX = 480;
    public const WEBP_QUALITY = 82;
    public const THUMB_QUALITY = 75;

    public static function shard(string $sha): string
    {
        return substr($sha, 0, 2) . '/' . substr($sha, 2, 2);
    }

    public static function absolute(string $relative): string
    {
        return Config::mediaPath($relative);
    }

    public static function url(string $relative): string
    {
        return Config::mediaUrl($relative);
    }

    public static function storeOriginal(string $tmpPath, string $sha, string $ext = 'png'): string
    {
        $relative = 'o/' . self::shard($sha) . '/' . $sha . '.' . $ext;
        $target = self::absolute($relative);
        Config::ensureDir(dirname($target));
        if (!is_file($target)) {
            if (!move_uploaded_file($tmpPath, $target)) {
                // fallback para CLI/importacao local
                if (!@copy($tmpPath, $target)) {
                    throw new RuntimeException('Falha ao gravar o arquivo original.');
                }
                @unlink($tmpPath);
            }
        } elseif (is_file($tmpPath)) {
            @unlink($tmpPath);
        }
        return $relative;
    }

    /**
     * Gera display + thumb e devolve os caminhos relativos.
     *
     * @return array{disp:string,thumb:string,width:int,height:int}
     */
    public static function derive(string $origRelative, string $sha): array
    {
        $source = self::absolute($origRelative);
        $info = @getimagesize($source);
        if ($info === false) {
            throw new RuntimeException('Arquivo de imagem invalido.');
        }
        [$width, $height] = $info;

        $image = self::load($source, (int) $info[2]);
        if ($image === null) {
            throw new RuntimeException('Formato de imagem nao suportado pelo GD.');
        }

        $ext = function_exists('imagewebp') ? 'webp' : 'jpg';
        $dispRelative = 'd/' . self::shard($sha) . '/' . $sha . '.' . $ext;
        $thumbRelative = 't/' . self::shard($sha) . '/' . $sha . '.' . $ext;

        $disp = self::resize($image, self::DISPLAY_MAX);
        self::save($disp, self::absolute($dispRelative), self::WEBP_QUALITY, $ext);
        imagedestroy($disp);

        $thumb = self::resize($image, self::THUMB_MAX);
        self::save($thumb, self::absolute($thumbRelative), self::THUMB_QUALITY, $ext);
        imagedestroy($thumb);

        imagedestroy($image);

        return ['disp' => $dispRelative, 'thumb' => $thumbRelative, 'width' => $width, 'height' => $height];
    }

    private static function load(string $path, int $type): ?GdImage
    {
        $image = match ($type) {
            IMAGETYPE_PNG => @imagecreatefrompng($path),
            IMAGETYPE_JPEG => @imagecreatefromjpeg($path),
            IMAGETYPE_WEBP => function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($path) : false,
            IMAGETYPE_GIF => @imagecreatefromgif($path),
            default => false,
        };
        return $image instanceof GdImage ? $image : null;
    }

    private static function resize(GdImage $image, int $max): GdImage
    {
        $width = imagesx($image);
        $height = imagesy($image);
        $scale = min(1.0, $max / max($width, $height));
        $targetW = max(1, (int) round($width * $scale));
        $targetH = max(1, (int) round($height * $scale));

        $canvas = imagecreatetruecolor($targetW, $targetH);
        imagealphablending($canvas, false);
        imagesavealpha($canvas, true);
        $transparent = imagecolorallocatealpha($canvas, 0, 0, 0, 127);
        imagefilledrectangle($canvas, 0, 0, $targetW, $targetH, $transparent);
        imagecopyresampled($canvas, $image, 0, 0, 0, 0, $targetW, $targetH, $width, $height);

        return $canvas;
    }

    private static function save(GdImage $image, string $target, int $quality, string $ext): void
    {
        Config::ensureDir(dirname($target));
        $ok = $ext === 'webp'
            ? imagewebp($image, $target, $quality)
            : imagejpeg($image, $target, $quality);
        if (!$ok) {
            throw new RuntimeException('Falha ao gravar a derivada: ' . basename($target));
        }
        @chmod($target, 0644);
    }

    public static function removeRelative(?string $relative): void
    {
        if ($relative === null || $relative === '') {
            return;
        }
        $path = self::absolute($relative);
        $base = realpath(Config::mediaPath()) ?: Config::mediaPath();
        $real = realpath($path);
        if ($real !== false && str_starts_with($real, $base)) {
            @unlink($real);
        }
    }

    private const STREAM_TYPES = [
        'webp' => 'image/webp',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'png' => 'image/png',
        'gif' => 'image/gif',
    ];

    /**
     * Entrega o arquivo de midia apenas para quem tem sessao ativa.
     * A rota /media/<caminho> passa pelo front controller; nada em media/ e publico.
     */
    public static function stream(string $relative): never
    {
        $relative = str_replace('\\', '/', rawurldecode($relative));
        $extension = strtolower(pathinfo($relative, PATHINFO_EXTENSION));
        if (
            !isset(self::STREAM_TYPES[$extension])
            || str_contains($relative, '..')
            || str_starts_with($relative, '/')
        ) {
            Http::error('not_found', 'Midia nao encontrada.', 404);
        }

        $base = realpath(Config::mediaPath());
        $file = realpath(Config::mediaPath($relative));
        if (
            $base === false
            || $file === false
            || !is_file($file)
            || !str_starts_with($file, $base . DIRECTORY_SEPARATOR)
        ) {
            Http::error('not_found', 'Midia nao encontrada.', 404);
        }

        $size = (int) filesize($file);
        $mtime = (int) filemtime($file);
        $etag = '"' . substr(hash('sha256', $relative . ':' . $size . ':' . $mtime), 0, 32) . '"';

        if (trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $etag) {
            http_response_code(304);
            exit;
        }

        header('Content-Type: ' . self::STREAM_TYPES[$extension]);
        header('Content-Length: ' . $size);
        header('ETag: ' . $etag);
        header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');
        header('Cache-Control: private, max-age=604800, immutable');

        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        readfile($file);
        exit;
    }

    public static function storageStats(): array
    {
        $bytes = (int) Db::value('SELECT COALESCE(SUM(bytes), 0) FROM images', [], 0);
        return [
            'bytes_original' => $bytes,
            'bytes_total_estimate' => (int) round($bytes * 1.22),
            'count' => (int) Db::value('SELECT COUNT(*) FROM images', [], 0),
        ];
    }
}

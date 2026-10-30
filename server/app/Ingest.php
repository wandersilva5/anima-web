<?php
declare(strict_types=1);

/**
 * Recebe uma imagem + metadata.json do sincronizador e indexa tudo.
 * Idempotente por sha256 e por uuid.
 */
final class Ingest
{
    private const UUID_REGEX = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

    public static function isValidUuid(string $uuid): bool
    {
        return preg_match(self::UUID_REGEX, $uuid) === 1;
    }

    /**
     * @param array{tmp_name:string,error:int,size:int,name:string} $file
     */
    public static function fromUpload(array $file, string $uuid, string $metadataRaw): array
    {
        $startedAt = microtime(true);

        $uuid = strtolower(trim($uuid));
        if (!self::isValidUuid($uuid)) {
            Http::error('invalid_uuid', 'UUID invalido.', 422);
        }

        $error = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($error !== UPLOAD_ERR_OK) {
            Http::error('upload_failed', 'Falha no upload da imagem (codigo ' . $error . ').', 422);
        }

        $tmp = (string) $file['tmp_name'];
        $maxBytes = Config::int('SYNC_MAX_BYTES', 20971520);
        $size = (int) ($file['size'] ?? 0);
        if ($size <= 0 || $size > $maxBytes) {
            Http::error('invalid_size', 'Imagem fora do limite de tamanho.', 422);
        }

        $info = @getimagesize($tmp);
        if ($info === false) {
            Http::error('invalid_image', 'Arquivo enviado nao e uma imagem valida.', 422);
        }
        $allowed = [IMAGETYPE_PNG => 'png', IMAGETYPE_JPEG => 'jpg', IMAGETYPE_WEBP => 'webp'];
        $ext = $allowed[$info[2]] ?? null;
        if ($ext === null) {
            Http::error('invalid_image', 'Formato nao suportado (use PNG, JPEG ou WebP).', 422);
        }

        $sha = hash_file('sha256', $tmp);
        if ($sha === false) {
            Http::error('hash_failed', 'Nao foi possivel calcular o hash da imagem.', 500);
        }

        $existing = Db::one('SELECT uuid, deleted_at FROM images WHERE sha256 = ? LIMIT 1', [$sha]);
        if ($existing !== null) {
            self::log((int) Db::value('SELECT id FROM images WHERE sha256 = ?', [$sha]), $uuid, $size, $startedAt, 'duplicate');
            return [
                'status' => 'already_exists',
                'uuid' => $existing['uuid'],
                'deleted' => $existing['deleted_at'] !== null,
            ];
        }

        $metadata = json_decode($metadataRaw, true);
        if (!is_array($metadata)) {
            Http::error('invalid_metadata', 'metadata.json invalido.', 422);
        }
        $params = is_array($metadata['params'] ?? null) ? $metadata['params'] : [];
        $prompt = (string) ($params['prompt'] ?? '');
        $negative = (string) ($params['negativePrompt'] ?? '');
        $tsMs = isset($metadata['timestamp']) ? (int) $metadata['timestamp'] : (int) (time() * 1000);
        if ($tsMs <= 0) {
            $tsMs = (int) (time() * 1000);
        }

        $origRelative = Media::storeOriginal($tmp, $sha, $ext);
        $derived = Media::derive($origRelative, $sha);

        $filename = basename((string) ($metadata['images'][0]['filename'] ?? ($uuid . '.' . $ext)));

        $imageId = Db::transaction(static function () use (
            $uuid, $filename, $sha, $size, $derived, $origRelative, $prompt, $negative,
            $params, $metadata, $tsMs
        ): int {
            $modelName = trim((string) ($params['modelName'] ?? ''));
            $modelId = null;
            if ($modelName !== '') {
                Db::run(
                    'INSERT INTO models (name, usage_count) VALUES (?, 1)
                     ON DUPLICATE KEY UPDATE usage_count = usage_count + 1',
                    [$modelName]
                );
                $modelId = (int) Db::value('SELECT id FROM models WHERE name = ?', [$modelName], 0);
            }

            $imageId = Db::insert(
                'INSERT INTO images
                    (uuid, folder, filename, sha256, bytes, width, height, path_orig, path_disp, path_thumb,
                     prompt, negative_prompt, prompt_hash, model_id, seed, steps, cfg, params_json,
                     ts_ms, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
                [
                    $uuid,
                    $uuid,
                    mb_substr($filename, 0, 160),
                    $sha,
                    $size,
                    $derived['width'],
                    $derived['height'],
                    $origRelative,
                    $derived['disp'],
                    $derived['thumb'],
                    $prompt,
                    $negative,
                    sha1($prompt),
                    $modelId,
                    isset($params['seed']) ? (int) $params['seed'] : null,
                    isset($params['steps']) ? (int) $params['steps'] : null,
                    isset($params['cfg']) ? round((float) $params['cfg'], 2) : null,
                    json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    $tsMs,
                ]
            );

            $position = 0;
            foreach (($params['loras'] ?? []) as $lora) {
                if (!is_array($lora)) {
                    continue;
                }
                $name = trim((string) ($lora['name'] ?? ''));
                if ($name === '') {
                    continue;
                }
                Db::run(
                    'INSERT INTO loras (name, usage_count) VALUES (?, 1)
                     ON DUPLICATE KEY UPDATE usage_count = usage_count + 1',
                    [$name]
                );
                $loraId = (int) Db::value('SELECT id FROM loras WHERE name = ?', [$name], 0);
                Db::run(
                    'INSERT IGNORE INTO image_loras (image_id, lora_id, strength_model, strength_clip, pos)
                     VALUES (?, ?, ?, ?, ?)',
                    [
                        $imageId,
                        $loraId,
                        isset($lora['strengthModel']) ? round((float) $lora['strengthModel'], 2) : null,
                        isset($lora['strengthClip']) ? round((float) $lora['strengthClip'], 2) : null,
                        $position++,
                    ]
                );
            }

            Tags::attachToImage($imageId, $prompt);

            return $imageId;
        });

        self::log($imageId, $uuid, $size, $startedAt, 'upload');

        return [
            'status' => 'created',
            'uuid' => $uuid,
            'id' => $imageId,
            'sha256' => $sha,
            'width' => $derived['width'],
            'height' => $derived['height'],
            'bytes' => $size,
            'tags' => (int) Db::value('SELECT COUNT(*) FROM image_tags WHERE image_id = ?', [$imageId], 0),
        ];
    }

    private static function log(?int $imageId, string $uuid, int $bytes, float $startedAt, string $action): void
    {
        Db::run(
            'INSERT INTO upload_log (image_id, uuid, ip, bytes, ms, action, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [$imageId, $uuid, Http::clientIp(), $bytes, (int) round((microtime(true) - $startedAt) * 1000), $action]
        );
    }

    /** Recalcula todas as tags (usar depois de ampliar o dicionario). */
    public static function retagAll(?callable $progress = null): int
    {
        $rows = Db::all('SELECT id, prompt FROM images WHERE prompt IS NOT NULL AND prompt <> ""');
        $count = 0;
        foreach ($rows as $row) {
            Tags::detachFromImage((int) $row['id']);
            Tags::attachToImage((int) $row['id'], (string) $row['prompt']);
            $count++;
            if ($progress !== null && $count % 200 === 0) {
                $progress($count);
            }
        }
        return $count;
    }
}

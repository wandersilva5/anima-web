<?php
declare(strict_types=1);

/**
 * Normalizacao do prompt (danbooru + texto livre) e dicionario EN -> PT.
 */
final class Tags
{
    private static ?array $dictionary = null;

    public static function dictionaryPath(): string
    {
        $candidates = [
            Config::path('../shared/tags.pt.json'),
            Config::path('shared/tags.pt.json'),
            dirname(Config::root()) . '/shared/tags.pt.json',
        ];
        foreach ($candidates as $file) {
            if (is_file($file)) {
                return $file;
            }
        }
        return $candidates[0];
    }

    public static function dictionary(): array
    {
        if (self::$dictionary !== null) {
            return self::$dictionary;
        }
        $file = self::dictionaryPath();
        $raw = is_file($file) ? file_get_contents($file) : false;
        $data = $raw === false ? null : json_decode($raw, true);
        if (!is_array($data)) {
            app_log('error', 'Dicionario de tags indisponivel', ['file' => $file]);
            $data = ['categories' => [], 'noise' => ['tags' => [], 'patterns' => []], 'tags' => []];
        }

        $map = [];
        foreach (($data['tags'] ?? []) as $entry) {
            $en = self::clean((string) ($entry['en'] ?? ''));
            if ($en === '') {
                continue;
            }
            $map[$en] = [
                'pt' => (string) ($entry['pt'] ?? $en),
                'cat' => (string) ($entry['cat'] ?? 'outros'),
                'sub' => (string) ($entry['sub'] ?? ''),
            ];
        }

        $data['_map'] = $map;
        self::$dictionary = $data;
        return self::$dictionary;
    }

    public static function categories(): array
    {
        return self::dictionary()['categories'] ?? [];
    }

    private static function clean(string $value): string
    {
        $value = mb_strtolower($value, 'UTF-8');
        $value = str_replace('_', ' ', $value);
        $value = preg_replace('/\s+/u', ' ', $value) ?? $value;
        return trim($value);
    }

    /**
     * Transforma o prompt bruto em uma lista de tags normalizadas.
     *
     * @return list<string>
     */
    public static function normalize(string $prompt): array
    {
        if (trim($prompt) === '') {
            return [];
        }

        $text = str_replace(["\r\n", "\r", "\n", "\t"], ',', $prompt);
        $text = preg_replace('/\s*:\s*\d+(?:[.,]\d+)?/', '', $text) ?? $text;
        $text = str_replace(['(', ')', '[', ']', '{', '}'], ' ', $text);
        $text = mb_strtolower($text, 'UTF-8');
        $text = str_replace('_', ' ', $text);

        $noiseTags = array_flip(array_map([self::class, 'clean'], self::dictionary()['noise']['tags'] ?? []));
        $patterns = self::dictionary()['noise']['patterns'] ?? [];

        $out = [];
        foreach (explode(',', $text) as $part) {
            $tag = preg_replace('/\s+/u', ' ', $part) ?? $part;
            $tag = trim($tag, " \t\n\r\0\x0B.-*;|\"'");
            $length = mb_strlen($tag);
            if ($length < 3 || $length > 60) {
                continue;
            }
            if (preg_match('/[^\p{L}\p{N}\s\'\-\.]/u', $tag) === 1) {
                continue;
            }
            if (isset($noiseTags[$tag])) {
                continue;
            }
            if (count(explode(' ', $tag)) > 7) {
                continue;
            }
            if (preg_match('/^\d+$/', $tag) === 1) {
                continue;
            }
            $isNoise = false;
            foreach ($patterns as $pattern) {
                $regex = '~' . $pattern . '~iu';
                if (@preg_match($regex, $tag) === 1) {
                    $isNoise = true;
                    break;
                }
            }
            if ($isNoise) {
                continue;
            }
            $tag = trim($tag, ' .');
            if ($tag !== '') {
                $out[$tag] = true;
            }
        }

        return array_keys($out);
    }

    /**
     * Tags prontas para gravar, ja com rotulo PT e categoria.
     *
     * @return list<array{en:string,pt:string,cat:string,sub:string,curated:int}>
     */
    public static function extract(string $prompt): array
    {
        $map = self::dictionary()['_map'] ?? [];
        $result = [];
        foreach (self::normalize($prompt) as $en) {
            if (isset($map[$en])) {
                $result[] = [
                    'en' => $en,
                    'pt' => $map[$en]['pt'],
                    'cat' => $map[$en]['cat'],
                    'sub' => $map[$en]['sub'],
                    'curated' => 1,
                ];
            } else {
                $result[] = ['en' => $en, 'pt' => $en, 'cat' => 'outros', 'sub' => '', 'curated' => 0];
            }
        }
        return $result;
    }

    /** Grava as tags da imagem e mantem os contadores. */
    public static function attachToImage(int $imageId, string $prompt): int
    {
        $attached = 0;
        $seen = [];

        foreach (self::extract($prompt) as $tag) {
            if (isset($seen[$tag['en']])) {
                continue;
            }
            $seen[$tag['en']] = true;

            $row = Db::one('SELECT id, curated FROM tags WHERE name_en = ? LIMIT 1', [$tag['en']]);
            if ($row === null) {
                $tagId = Db::insert(
                    'INSERT INTO tags (name_en, label_pt, categoria, subcategoria, curated, usage_count)
                     VALUES (?, ?, ?, ?, ?, 0)',
                    [$tag['en'], $tag['pt'], $tag['cat'], $tag['sub'], $tag['curated']]
                );
            } else {
                $tagId = (int) $row['id'];
                if ((int) $row['curated'] === 0 && $tag['curated'] === 1) {
                    Db::run(
                        'UPDATE tags SET label_pt = ?, categoria = ?, subcategoria = ?, curated = 1 WHERE id = ?',
                        [$tag['pt'], $tag['cat'], $tag['sub'], $tagId]
                    );
                }
            }

            $stmt = Db::run('INSERT IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)', [$imageId, $tagId]);
            if ($stmt->rowCount() > 0) {
                Db::run('UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?', [$tagId]);
                $attached++;
            }
        }

        return $attached;
    }

    public static function detachFromImage(int $imageId): void
    {
        $tags = Db::all('SELECT tag_id FROM image_tags WHERE image_id = ?', [$imageId]);
        Db::run('DELETE FROM image_tags WHERE image_id = ?', [$imageId]);
        foreach ($tags as $row) {
            Db::run('UPDATE tags SET usage_count = GREATEST(usage_count - 1, 0) WHERE id = ?', [$row['tag_id']]);
        }
    }

    /** Sugestoes de busca em PT (rotulo) ou EN (tag original). */
    public static function searchTerms(string $query, int $limit = 8): array
    {
        $like = '%' . str_replace(['%', '_'], ['\%', '\_'], mb_strtolower($query)) . '%';
        return Db::all(
            "SELECT id, name_en, label_pt, categoria, usage_count
               FROM tags
              WHERE label_pt LIKE ? OR name_en LIKE ?
              ORDER BY curated DESC, usage_count DESC
              LIMIT {$limit}",
            [$like, $like]
        );
    }
}

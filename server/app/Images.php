<?php
declare(strict_types=1);

final class Images
{
    private const SORTS = ['recentes', 'antigos', 'aleatorio', 'favoritos'];
    private const CATEGORIES = [
        'cabelo', 'olhos', 'rosto', 'expressao', 'pose', 'corpo',
        'roupa', 'acessorios', 'cenario', 'iluminacao', 'estilo', 'hora', 'outros',
    ];

    // ----------------------------------------------------------- filtros

    /** @return array<string,mixed> */
    public static function filtersFromRequest(): array
    {
        $sort = Http::query('sort', 'recentes');
        if (!in_array($sort, self::SORTS, true)) {
            $sort = 'recentes';
        }

        $categoria = Http::query('categoria');
        if ($categoria !== null && !in_array($categoria, self::CATEGORIES, true)) {
            $categoria = null;
        }

        $tags = [];
        foreach (Http::queryList('tags') as $raw) {
            if (ctype_digit($raw)) {
                $tags[] = (int) $raw;
            }
        }
        $tags = array_values(array_unique(array_slice($tags, 0, 40)));

        return [
            'tags' => $tags,
            'mode' => Http::query('mode', 'and') === 'or' ? 'or' : 'and',
            'categoria' => $categoria,
            'model' => Http::query('model'),
            'lora' => Http::query('lora'),
            'q' => Http::query('q'),
            'de' => self::dateToMs(Http::query('de')),
            'ate' => self::dateToMs(Http::query('ate'), true),
            'fav' => Http::query('fav') === '1',
            'sort' => $sort,
            'seed' => Http::queryInt('seed', 1, 1, 999999999),
            'trash' => false,
        ];
    }

    private static function dateToMs(?string $date, bool $endOfDay = false): ?int
    {
        if ($date === null) {
            return null;
        }
        $time = strtotime($date . ($endOfDay ? ' 23:59:59' : ' 00:00:00'));
        return $time === false ? null : $time * 1000;
    }

    /**
     * @param array<string,mixed> $f
     * @param list<string> $skip dimensoes ignoradas (para facetas)
     * @return array{0:string,1:array<string,mixed>}
     */
    private static function buildWhere(array $f, array $skip = []): array
    {
        $clauses = [];
        $params = [];

        $clauses[] = $f['trash'] ? 'i.deleted_at IS NOT NULL' : 'i.deleted_at IS NULL';

        if (!in_array('model', $skip, true) && ($f['model'] ?? null) !== null) {
            if (ctype_digit((string) $f['model'])) {
                $clauses[] = 'i.model_id = ?';
                $params[] = (int) $f['model'];
            } else {
                $clauses[] = 'm.name LIKE ?';
                $params[] = '%' . $f['model'] . '%';
            }
        }

        if (!in_array('lora', $skip, true) && ($f['lora'] ?? null) !== null) {
            $clauses[] = 'EXISTS (SELECT 1 FROM image_loras il2 JOIN loras l2 ON l2.id = il2.lora_id
                                  WHERE il2.image_id = i.id AND (l2.name LIKE ? OR l2.id = ?))';
            $params[] = '%' . $f['lora'] . '%';
            $params[] = ctype_digit((string) $f['lora']) ? (int) $f['lora'] : 0;
        }

        if (!in_array('categoria', $skip, true) && ($f['categoria'] ?? null) !== null) {
            $clauses[] = 'EXISTS (SELECT 1 FROM image_tags itc JOIN tags tc ON tc.id = itc.tag_id
                                  WHERE itc.image_id = i.id AND tc.categoria = ?)';
            $params[] = $f['categoria'];
        }

        if (!in_array('tags', $skip, true) && ($f['tags'] ?? []) !== []) {
            $in = implode(',', array_fill(0, count($f['tags']), '?'));
            if ($f['mode'] === 'or') {
                $clauses[] = "EXISTS (SELECT 1 FROM image_tags it WHERE it.image_id = i.id AND it.tag_id IN ($in))";
                $params = array_merge($params, $f['tags']);
            } else {
                $clauses[] = "(SELECT COUNT(DISTINCT it.tag_id) FROM image_tags it
                                WHERE it.image_id = i.id AND it.tag_id IN ($in)) = " . count($f['tags']);
                $params = array_merge($params, $f['tags']);
            }
        }

        if (($f['q'] ?? null) !== null) {
            $like = '%' . $f['q'] . '%';
            $clauses[] = '(i.prompt LIKE ? OR i.negative_prompt LIKE ?
                           OR EXISTS (SELECT 1 FROM image_tags itq JOIN tags tq ON tq.id = itq.tag_id
                                       WHERE itq.image_id = i.id AND (tq.label_pt LIKE ? OR tq.name_en LIKE ?)))';
            array_push($params, $like, $like, $like, $like);
        }

        if (($f['de'] ?? null) !== null) {
            $clauses[] = 'i.ts_ms >= ?';
            $params[] = $f['de'];
        }
        if (($f['ate'] ?? null) !== null) {
            $clauses[] = 'i.ts_ms <= ?';
            $params[] = $f['ate'];
        }
        if (!empty($f['fav'])) {
            $clauses[] = 'i.favorite = 1';
        }

        return ['WHERE ' . implode(' AND ', $clauses), $params];
    }

    private static function orderBy(array $f): string
    {
        return match ($f['sort']) {
            'antigos' => 'i.ts_ms ASC, i.id ASC',
            'favoritos' => 'i.favorite DESC, i.ts_ms DESC, i.id DESC',
            'aleatorio' => '((i.id * 2654435761 + ' . (int) $f['seed'] . ') % 2147483647) ASC',
            default => 'i.ts_ms DESC, i.id DESC',
        };
    }

    private static function fromClause(): string
    {
        return 'FROM images i LEFT JOIN models m ON m.id = i.model_id';
    }

    // ------------------------------------------------------------ listagem

    /** @param array<string,mixed> $f */
    public static function paginate(array $f, ?string $cursor, int $limit): array
    {
        $limit = max(1, min(96, $limit));
        [$where, $params] = self::buildWhere($f);
        $order = self::orderBy($f);
        $keyset = in_array($f['sort'], ['recentes', 'antigos'], true);

        $extra = '';
        $offset = 0;

        if ($cursor !== null && $cursor !== '') {
            if ($keyset && str_starts_with($cursor, 'k:')) {
                [, $ts, $id] = explode(':', $cursor) + [1 => '0', 2 => '0'];
                if ($f['sort'] === 'antigos') {
                    $extra = ' AND (i.ts_ms > ? OR (i.ts_ms = ? AND i.id > ?))';
                } else {
                    $extra = ' AND (i.ts_ms < ? OR (i.ts_ms = ? AND i.id < ?))';
                }
                array_push($params, (int) $ts, (int) $ts, (int) $id);
            } elseif (str_starts_with($cursor, 'o:')) {
                $offset = max(0, (int) substr($cursor, 2));
            }
        }

        $rows = Db::all(
            'SELECT i.id, i.uuid, i.width, i.height, i.path_thumb, i.path_disp, i.favorite, i.ts_ms,
                    i.bytes, m.name AS model_name
             ' . self::fromClause() . ' ' . $where . $extra . '
             ORDER BY ' . $order . '
             LIMIT ' . ($limit + 1) . ' OFFSET ' . $offset,
            $params
        );

        $hasMore = count($rows) > $limit;
        if ($hasMore) {
            $rows = array_slice($rows, 0, $limit);
        }

        $items = array_map(static fn (array $row) => self::mapListItem($row), $rows);

        $next = null;
        if ($hasMore && $items !== []) {
            $last = $rows[count($rows) - 1];
            $next = $keyset
                ? 'k:' . $last['ts_ms'] . ':' . $last['id']
                : 'o:' . ($offset + $limit);
        }

        $total = (int) Db::value(
            'SELECT COUNT(*) ' . self::fromClause() . ' ' . $where,
            $params
        );

        return ['items' => $items, 'next' => $next, 'total' => $total, 'sort' => $f['sort']];
    }

    private static function mapListItem(array $row): array
    {
        return [
            'uuid' => $row['uuid'],
            'thumb' => Media::url($row['path_thumb']),
            'display' => Media::url($row['path_disp']),
            'width' => (int) $row['width'],
            'height' => (int) $row['height'],
            'favorite' => (int) $row['favorite'] === 1,
            'ts' => (int) $row['ts_ms'],
            'bytes' => (int) $row['bytes'],
            'model' => $row['model_name'],
        ];
    }

    // -------------------------------------------------------------- detalhe

    /** @param array<string,mixed> $f */
    public static function detail(string $uuid, array $f, bool $countView = false): array
    {
        $row = Db::one(
            'SELECT i.*, m.name AS model_name
             ' . self::fromClause() . ' WHERE i.uuid = ? LIMIT 1',
            [$uuid]
        );
        if ($row === null) {
            Http::error('not_found', 'Imagem nao encontrada.', 404);
        }

        [$where, $params] = self::buildWhere($f);
        $ids = array_map(
            static fn (array $r) => (int) $r['id'],
            Db::all('SELECT i.id ' . self::fromClause() . ' ' . $where . ' ORDER BY ' . self::orderBy($f), $params)
        );
        $imageId = (int) $row['id'];
        $position = array_search($imageId, $ids, true);
        $position = $position === false ? null : $position + 1;
        $total = count($ids);

        $neighborIds = [];
        if ($position !== null) {
            $neighborIds = [
                'prev' => $ids[$position - 2] ?? null,
                'next' => $ids[$position] ?? null,
            ];
        }
        $neighbors = ['prev' => null, 'next' => null];
        foreach ($neighborIds as $key => $id) {
            if ($id !== null) {
                $neighbors[$key] = Db::value('SELECT uuid FROM images WHERE id = ?', [$id]);
            }
        }

        if ($countView) {
            Db::run('UPDATE images SET view_count = view_count + 1 WHERE id = ?', [$imageId]);
        }

        $loras = Db::all(
            'SELECT l.name, il.strength_model, il.strength_clip
               FROM image_loras il JOIN loras l ON l.id = il.lora_id
              WHERE il.image_id = ? ORDER BY il.pos ASC',
            [$imageId]
        );

        $tags = Db::all(
            'SELECT t.id, t.name_en, t.label_pt, t.categoria, t.subcategoria, t.curated
               FROM image_tags it JOIN tags t ON t.id = it.tag_id
              WHERE it.image_id = ?
              ORDER BY FIELD(t.categoria, "cabelo","olhos","rosto","expressao","pose","corpo","roupa",
                             "acessorios","cenario","iluminacao","estilo","hora","outros"), t.usage_count DESC',
            [$imageId]
        );

        $byCategory = [];
        foreach ($tags as $tag) {
            $byCategory[$tag['categoria']][] = [
                'id' => (int) $tag['id'],
                'en' => $tag['name_en'],
                'pt' => $tag['label_pt'],
                'sub' => $tag['subcategoria'],
                'curated' => (int) $tag['curated'] === 1,
            ];
        }

        $params = json_decode((string) $row['params_json'], true);

        return [
            'uuid' => $row['uuid'],
            'folder' => $row['folder'],
            'filename' => $row['filename'],
            'urls' => [
                'orig' => Media::url($row['path_orig']),
                'display' => Media::url($row['path_disp']),
                'thumb' => Media::url($row['path_thumb']),
            ],
            'width' => (int) $row['width'],
            'height' => (int) $row['height'],
            'bytes' => (int) $row['bytes'],
            'sha256' => $row['sha256'],
            'prompt' => $row['prompt'],
            'negative_prompt' => $row['negative_prompt'],
            'model' => $row['model_name'],
            'model_file' => $params['modelName'] ?? null,
            'seed' => $row['seed'] !== null ? (int) $row['seed'] : null,
            'steps' => $row['steps'] !== null ? (int) $row['steps'] : null,
            'cfg' => $row['cfg'] !== null ? (float) $row['cfg'] : null,
            'ts' => (int) $row['ts_ms'],
            'created_at' => $row['created_at'],
            'favorite' => (int) $row['favorite'] === 1,
            'view_count' => (int) $row['view_count'],
            'deleted' => $row['deleted_at'] !== null,
            'loras' => array_map(static fn (array $l) => [
                'name' => $l['name'],
                'short' => basename(str_replace('\\', '/', (string) $l['name'])),
                'model_strength' => $l['strength_model'] !== null ? (float) $l['strength_model'] : null,
                'clip_strength' => $l['strength_clip'] !== null ? (float) $l['strength_clip'] : null,
            ], $loras),
            'tags' => $tags,
            'tags_by_category' => $byCategory,
            'position' => $position,
            'total' => $total,
            'neighbors' => $neighbors,
        ];
    }

    // --------------------------------------------------------------- facetas

    /** @param array<string,mixed> $f */
    public static function facets(array $f): array
    {
        $tagCounts = self::tagFacets($f);
        $models = self::modelFacets($f);
        $loras = self::loraFacets($f);

        $dictionary = Tags::categories();
        $grouped = [];
        foreach ($dictionary as $key => $meta) {
            $grouped[$key] = ['key' => $key, 'label' => $meta['label'] ?? $key, 'subs' => $meta['subs'] ?? [], 'tags' => []];
        }

        foreach ($tagCounts as $tag) {
            $cat = $tag['categoria'];
            if (!isset($grouped[$cat])) {
                $grouped[$cat] = ['key' => $cat, 'label' => $cat, 'subs' => [], 'tags' => []];
            }
            $grouped[$cat]['tags'][] = $tag;
        }

        $categories = [];
        foreach ($grouped as $key => $group) {
            if ($group['tags'] === [] && $key === 'outros') {
                continue;
            }
            $categories[] = [
                'key' => $key,
                'label' => $group['label'],
                'subs' => $group['subs'],
                'count' => array_sum(array_column($group['tags'], 'count')),
                'tags' => $group['tags'],
            ];
        }

        [$where, $params] = self::buildWhere($f);

        return [
            'categories' => $categories,
            'models' => $models,
            'loras' => $loras,
            'total' => (int) Db::value('SELECT COUNT(*) ' . self::fromClause() . ' ' . $where, $params),
        ];
    }

    /** @param array<string,mixed> $f */
    private static function tagFacets(array $f): array
    {
        [$where, $params] = self::buildWhere($f, ['tags']);
        $sub = 'SELECT i.id ' . self::fromClause() . ' ' . $where;

        $rows = Db::all(
            "SELECT it.tag_id, COUNT(*) AS c
               FROM image_tags it
              WHERE it.image_id IN ($sub)
              GROUP BY it.tag_id
              ORDER BY c DESC
              LIMIT 800",
            $params
        );
        if ($rows === []) {
            return [];
        }

        $ids = array_map(static fn (array $r) => (int) $r['tag_id'], $rows);
        $info = Db::all(
            'SELECT id, name_en, label_pt, categoria, subcategoria, curated, usage_count
               FROM tags WHERE id IN (' . implode(',', $ids) . ')'
        );
        $byId = [];
        foreach ($info as $row) {
            $byId[(int) $row['id']] = $row;
        }

        $out = [];
        foreach ($rows as $row) {
            $tag = $byId[(int) $row['tag_id']] ?? null;
            if ($tag === null) {
                continue;
            }
            $curated = (int) $tag['curated'] === 1;
            if (!$curated && $tag['categoria'] === 'outros' && (int) $row['c'] < 3) {
                continue;
            }
            $out[] = [
                'id' => (int) $tag['id'],
                'en' => $tag['name_en'],
                'pt' => $tag['label_pt'] !== '' ? $tag['label_pt'] : $tag['name_en'],
                'categoria' => $tag['categoria'],
                'sub' => $tag['subcategoria'],
                'curated' => $curated,
                'count' => (int) $row['c'],
            ];
        }
        return $out;
    }

    /** @param array<string,mixed> $f */
    private static function modelFacets(array $f): array
    {
        [$where, $params] = self::buildWhere($f, ['model']);
        return Db::all(
            'SELECT m.id, m.name, COUNT(*) AS count
             ' . self::fromClause() . ' ' . $where . '
             GROUP BY m.id, m.name ORDER BY count DESC LIMIT 40',
            $params
        ) ?? [];
    }

    /** @param array<string,mixed> $f */
    private static function loraFacets(array $f): array
    {
        [$where, $params] = self::buildWhere($f, ['lora']);
        $sub = 'SELECT i.id ' . self::fromClause() . ' ' . $where;
        return Db::all(
            "SELECT l.id, l.name, COUNT(*) AS count
               FROM image_loras il JOIN loras l ON l.id = il.lora_id
              WHERE il.image_id IN ($sub)
              GROUP BY l.id, l.name ORDER BY count DESC LIMIT 60",
            $params
        );
    }

    // ------------------------------------------------------------ favoritos

    public static function setFavorite(string $uuid, bool $value): array
    {
        $image = Db::one('SELECT id FROM images WHERE uuid = ?', [$uuid]);
        if ($image === null) {
            Http::error('not_found', 'Imagem nao encontrada.', 404);
        }
        Db::run('UPDATE images SET favorite = ?, updated_at = NOW() WHERE id = ?', [$value ? 1 : 0, $image['id']]);
        return ['uuid' => $uuid, 'favorite' => $value];
    }

    // --------------------------------------------------------------- lixeira

    public static function trashList(): array
    {
        $rows = Db::all(
            'SELECT i.uuid, i.path_thumb, i.deleted_at, i.ts_ms, m.name AS model_name
             FROM images i LEFT JOIN models m ON m.id = i.model_id
             WHERE i.deleted_at IS NOT NULL
             ORDER BY i.deleted_at DESC LIMIT 300'
        );
        return [
            'items' => array_map(static fn (array $r) => [
                'uuid' => $r['uuid'],
                'thumb' => Media::url($r['path_thumb']),
                'deleted_at' => $r['deleted_at'],
                'model' => $r['model_name'],
            ], $rows),
            'pending_local' => (int) Db::value("SELECT COUNT(*) FROM local_deletions WHERE status = 'pending'", [], 0),
        ];
    }

    public static function softDelete(string $uuid): array
    {
        $image = Db::one('SELECT id, folder, deleted_at FROM images WHERE uuid = ?', [$uuid]);
        if ($image === null) {
            Http::error('not_found', 'Imagem nao encontrada.', 404);
        }
        if ($image['deleted_at'] === null) {
            Db::run('UPDATE images SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?', [$image['id']]);
            app_log('info', 'Imagem movida para a lixeira', ['uuid' => $uuid]);
        }
        return ['uuid' => $uuid, 'deleted' => true];
    }

    public static function restore(string $uuid): array
    {
        $image = Db::one('SELECT id FROM images WHERE uuid = ?', [$uuid]);
        if ($image === null) {
            Http::error('not_found', 'Imagem nao encontrada.', 404);
        }
        Db::run('UPDATE images SET deleted_at = NULL, updated_at = NOW() WHERE id = ?', [$image['id']]);
        Db::run("DELETE FROM local_deletions WHERE uuid = ? AND status = 'pending'", [$uuid]);
        app_log('info', 'Imagem restaurada', ['uuid' => $uuid]);
        return ['uuid' => $uuid, 'deleted' => false];
    }

    /** Esvazia a lixeira: enfileira exclusao local e, opcionalmente, apaga do servidor. */
    public static function emptyTrash(bool $purgeRemote): array
    {
        $rows = Db::all('SELECT id, uuid, folder, path_orig, path_disp, path_thumb FROM images WHERE deleted_at IS NOT NULL');
        $queued = 0;

        foreach ($rows as $row) {
            Db::run(
                'INSERT INTO local_deletions (image_id, uuid, folder, requested_at, status)
                 SELECT ?, ?, ?, NOW(), "pending"
                  WHERE NOT EXISTS (SELECT 1 FROM local_deletions WHERE uuid = ? AND status = "pending")',
                [$row['id'], $row['uuid'], $row['folder'], $row['uuid']]
            );
            $queued++;

            if ($purgeRemote) {
                Media::removeRelative($row['path_orig']);
                Media::removeRelative($row['path_disp']);
                Media::removeRelative($row['path_thumb']);
                Tags::detachFromImage((int) $row['id']);
                Db::run('DELETE FROM images WHERE id = ?', [$row['id']]);
            }
        }

        app_log('info', 'Lixeira esvaziada', ['imagens' => count($rows), 'purge_remote' => $purgeRemote]);
        return ['queued' => $queued, 'purged' => $purgeRemote ? count($rows) : 0];
    }

    /** Remove do servidor sem tocar no PC (o app nao sera avisado). */
    public static function purgeRemote(string $uuid): array
    {
        $image = Db::one('SELECT id, path_orig, path_disp, path_thumb FROM images WHERE uuid = ?', [$uuid]);
        if ($image === null) {
            Http::error('not_found', 'Imagem nao encontrada.', 404);
        }
        Media::removeRelative($image['path_orig']);
        Media::removeRelative($image['path_disp']);
        Media::removeRelative($image['path_thumb']);
        Tags::detachFromImage((int) $image['id']);
        Db::run('DELETE FROM images WHERE id = ?', [$image['id']]);
        app_log('info', 'Imagem removida do servidor', ['uuid' => $uuid]);
        return ['uuid' => $uuid, 'purged' => true];
    }

    public static function stats(): array
    {
        $storage = Media::storageStats();
        return [
            'images' => (int) Db::value('SELECT COUNT(*) FROM images WHERE deleted_at IS NULL', [], 0),
            'trash' => (int) Db::value('SELECT COUNT(*) FROM images WHERE deleted_at IS NOT NULL', [], 0),
            'favorites' => (int) Db::value('SELECT COUNT(*) FROM images WHERE favorite = 1 AND deleted_at IS NULL', [], 0),
            'bytes' => $storage['bytes_original'],
            'bytes_total' => $storage['bytes_total_estimate'],
            'models' => (int) Db::value('SELECT COUNT(*) FROM models', [], 0),
            'loras' => (int) Db::value('SELECT COUNT(*) FROM loras', [], 0),
            'tags' => (int) Db::value('SELECT COUNT(*) FROM tags', [], 0),
            'pending_local_deletions' => (int) Db::value("SELECT COUNT(*) FROM local_deletions WHERE status = 'pending'", [], 0),
            'last_upload' => Db::value('SELECT MAX(created_at) FROM upload_log', []),
            'oldest' => Db::value('SELECT MIN(ts_ms) FROM images', []),
            'newest' => Db::value('SELECT MAX(ts_ms) FROM images', []),
        ];
    }
}

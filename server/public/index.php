<?php
declare(strict_types=1);

// Servidor embutido (php -S): deixa o PHP servir arquivos estaticos existentes.
// /media/ fica de fora: midia sempre passa pelo front controller (exige sessao).
if (PHP_SAPI === 'cli-server') {
    $staticPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    if (
        is_string($staticPath)
        && $staticPath !== '/'
        && !str_starts_with($staticPath, '/media/')
        && is_file(__DIR__ . $staticPath)
    ) {
        return false;
    }
}

// Localizacao do codigo privado. Ordem: ANIMA_APP_DIR (env), ao lado de public/ (dev),
// dentro do docroot em /anima (FTP preso ao site) ou fora do webroot (../anima/app).
$bootstrapCandidates = [
    getenv('ANIMA_APP_DIR') ?: '',
    dirname(__DIR__) . '/app/bootstrap.php',
    __DIR__ . '/anima/app/bootstrap.php',
    dirname(__DIR__, 2) . '/anima/app/bootstrap.php',
];
$bootstrapPath = null;
foreach ($bootstrapCandidates as $candidate) {
    if ($candidate !== '' && is_file($candidate)) {
        $bootstrapPath = $candidate;
        break;
    }
}
if ($bootstrapPath === null) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => ['code' => 'bootstrap_missing', 'message' => 'Codigo do servidor nao encontrado.']]);
    exit;
}
require_once $bootstrapPath;

const APP_VERSION = '1.0.0';

// ---------------------------------------------------------------- seguranca

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: no-referrer');
header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
header(
    "Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; "
    . "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; "
    . "font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
);
header('X-Robots-Tag: noindex, nofollow');

if (Http::isHttps()) {
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
}

set_time_limit(60);

// -------------------------------------------------------------------- path

$scriptName = $_SERVER['SCRIPT_NAME'] ?? '/index.php';
$scriptDir = rtrim(str_replace('\\', '/', dirname($scriptName)), '/');
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$uri = is_string($uri) ? $uri : '/';
if ($scriptDir !== '' && $scriptDir !== '/' && str_starts_with($uri, $scriptDir)) {
    $uri = substr($uri, strlen($scriptDir));
}
$uri = '/' . ltrim($uri, '/');

// --------------------------------------------------- SPA fallback (nao-API)

// /media/* vai para o roteador (exige sessao); o resto e HTML da SPA.
if (!str_starts_with($uri, '/api') && !str_starts_with($uri, '/media/')) {
    // Neste ponto o proprio index.php ja esta na pasta publica servida pelo Apache.
    $indexHtml = is_file(__DIR__ . '/index.html') ? __DIR__ . '/index.html' : Config::publicPath('index.html');
    if (is_file($indexHtml)) {
        header('Content-Type: text/html; charset=utf-8');
        header('Cache-Control: no-cache');
        readfile($indexHtml);
        exit;
    }
    Http::json(['app' => 'Galeria Anima', 'version' => APP_VERSION, 'status' => 'frontend ausente (rode npm run build)']);
}

$router = new Router();

// ------------------------------------------------------------------- health

$router->add('GET', '#^/api/health$#', static function (): void {
    Http::json([
        'ok' => true,
        'version' => APP_VERSION,
        'php' => PHP_VERSION,
        'gd' => extension_loaded('gd'),
        'webp' => function_exists('imagewebp'),
        'time' => date('c'),
    ]);
});

// ---------------------------------------------------------------- midias
// Nada em media/ e servido como arquivo estatico: o .htaccess manda /media/*
// para ca e a sessao e exigida antes de entregar a imagem.
$router->add('GET', '#^/media/(?P<path>.+)$#', static function (array $params): void {
    Auth::requireUser();
    Media::stream((string) $params['path']);
});

// --------------------------------------------------------------------- auth

$router->add('POST', '#^/api/auth/login$#', static function (): void {
    $body = Http::jsonBody();
    $result = Auth::login((string) ($body['username'] ?? ''), (string) ($body['password'] ?? ''));
    Http::json($result + [
        'settings' => [
            'site_name' => Db::value("SELECT v FROM settings WHERE k = 'site_name'", [], 'Galeria Anima'),
            'page_limit' => (int) Db::value("SELECT v FROM settings WHERE k = 'page_limit'", [], 48),
            'privacy_blur' => Db::value("SELECT v FROM settings WHERE k = 'privacy_blur'", [], '0') === '1',
        ],
    ]);
});

$router->add('POST', '#^/api/auth/logout$#', static function (): void {
    Auth::logout();
    Http::json(['ok' => true]);
});

$router->add('GET', '#^/api/auth/me$#', static function (): void {
    Http::json(Auth::me());
});

$router->add('POST', '#^/api/admin/password$#', static function (): void {
    Auth::requireCsrf();
    $body = Http::jsonBody();
    Auth::changePassword((string) ($body['current'] ?? ''), (string) ($body['password'] ?? ''));
    Http::json(['ok' => true]);
});

// -------------------------------------------------------------- leitura app

$router->add('GET', '#^/api/images$#', static function (): void {
    Auth::requireUser();
    $filters = Images::filtersFromRequest();
    $limit = Http::queryInt('limit', 48, 12, 96);
    Http::json(Images::paginate($filters, Http::query('cursor'), $limit));
});

$router->add('GET', '#^/api/images/(?P<uuid>[0-9a-fA-F-]{36})$#', static function (array $params): void {
    Auth::requireUser();
    $filters = Images::filtersFromRequest();
    Http::json(Images::detail($params['uuid'], $filters, Http::query('view') === '1'));
});

$router->add('POST', '#^/api/images/(?P<uuid>[0-9a-fA-F-]{36})/favorite$#', static function (array $params): void {
    Auth::requireCsrf();
    $body = Http::jsonBody();
    $value = array_key_exists('value', $body) ? (bool) $body['value'] : !((bool) Db::value(
        'SELECT favorite FROM images WHERE uuid = ?',
        [$params['uuid']],
        0
    ));
    Http::json(Images::setFavorite($params['uuid'], $value));
});

$router->add('POST', '#^/api/images/(?P<uuid>[0-9a-fA-F-]{36})/delete$#', static function (array $params): void {
    Auth::requireCsrf();
    Http::json(Images::softDelete($params['uuid']));
});

// Gira 90 graus: direction = cw (horario, padrao) ou ccw (anti-horario).
$router->add('POST', '#^/api/images/(?P<uuid>[0-9a-fA-F-]{36})/rotate$#', static function (array $params): void {
    Auth::requireCsrf();
    $body = Http::jsonBody();
    $direction = ($body['direction'] ?? 'cw') === 'ccw' ? 'ccw' : 'cw';
    try {
        Http::json(Images::rotate($params['uuid'], $direction));
    } catch (RuntimeException $error) {
        app_log('error', 'Falha ao girar imagem', ['uuid' => $params['uuid'], 'erro' => $error->getMessage()]);
        Http::error('rotate_failed', $error->getMessage(), 500);
    }
});

$router->add('GET', '#^/api/facets$#', static function (): void {
    Auth::requireUser();
    Http::json(Images::facets(Images::filtersFromRequest()));
});

$router->add('GET', '#^/api/dictionary$#', static function (): void {
    Auth::requireUser();
    $tags = Db::all(
        "SELECT id, name_en, label_pt, categoria, subcategoria, usage_count
           FROM tags
          WHERE curated = 1
          ORDER BY categoria ASC, usage_count DESC
          LIMIT 800"
    );
    Http::json([
        'categories' => Tags::categories(),
        'tags' => array_map(static fn (array $t) => [
            'id' => (int) $t['id'],
            'en' => $t['name_en'],
            'pt' => $t['label_pt'] !== '' ? $t['label_pt'] : $t['name_en'],
            'categoria' => $t['categoria'],
            'sub' => $t['subcategoria'],
            'usage' => (int) $t['usage_count'],
        ], $tags),
    ]);
});

$router->add('GET', '#^/api/search/tags$#', static function (): void {
    Auth::requireUser();
    $q = Http::query('q', '');
    Http::json(['items' => $q === '' || mb_strlen($q) < 2 ? [] : Tags::searchTerms($q)]);
});

$router->add('GET', '#^/api/stats$#', static function (): void {
    Auth::requireUser();
    Http::json(Images::stats());
});

// -------------------------------------------------------------------- admin

$router->add('GET', '#^/api/admin/trash$#', static function (): void {
    Auth::requireUser();
    Http::json(Images::trashList());
});

$router->add('POST', '#^/api/admin/images/(?P<uuid>[0-9a-fA-F-]{36})/restore$#', static function (array $params): void {
    Auth::requireCsrf();
    Http::json(Images::restore($params['uuid']));
});

$router->add('POST', '#^/api/admin/images/(?P<uuid>[0-9a-fA-F-]{36})/purge$#', static function (array $params): void {
    Auth::requireCsrf();
    Http::json(Images::purgeRemote($params['uuid']));
});

$router->add('POST', '#^/api/admin/trash/empty$#', static function (): void {
    Auth::requireCsrf();
    $body = Http::jsonBody();
    Http::json(Images::emptyTrash((bool) ($body['purge_remote'] ?? false)));
});

$router->add('GET', '#^/api/admin/tags$#', static function (): void {
    Auth::requireUser();
    $q = Http::query('q');
    $categoria = Http::query('categoria');
    $onlyPending = Http::query('pending') === '1';
    $limit = Http::queryInt('limit', 60, 10, 200);
    $offset = Http::queryInt('offset', 0, 0, 100000);

    $where = ['1=1'];
    $params = [];
    if ($q !== null) {
        $where[] = '(name_en LIKE ? OR label_pt LIKE ?)';
        $params[] = '%' . $q . '%';
        $params[] = '%' . $q . '%';
    }
    if ($categoria !== null) {
        $where[] = 'categoria = ?';
        $params[] = $categoria;
    }
    if ($onlyPending) {
        $where[] = 'curated = 0';
    }
    $sqlWhere = implode(' AND ', $where);

    $rows = Db::all(
        "SELECT id, name_en, label_pt, categoria, subcategoria, curated, usage_count
           FROM tags WHERE $sqlWhere
          ORDER BY curated ASC, usage_count DESC
          LIMIT $limit OFFSET $offset",
        $params
    );
    $total = (int) Db::value("SELECT COUNT(*) FROM tags WHERE $sqlWhere", $params);

    Http::json([
        'items' => array_map(static fn (array $t) => [
            'id' => (int) $t['id'],
            'en' => $t['name_en'],
            'pt' => $t['label_pt'],
            'categoria' => $t['categoria'],
            'sub' => $t['subcategoria'],
            'curated' => (int) $t['curated'] === 1,
            'usage' => (int) $t['usage_count'],
        ], $rows),
        'total' => $total,
    ]);
});

$router->add('POST', '#^/api/admin/tags/(?P<id>\d+)$#', static function (array $params): void {
    Auth::requireCsrf();
    $body = Http::jsonBody();
    $categoria = (string) ($body['categoria'] ?? 'outros');
    $allowed = ['cabelo', 'olhos', 'rosto', 'expressao', 'pose', 'corpo', 'roupa', 'acessorios', 'cenario', 'iluminacao', 'estilo', 'hora', 'outros'];
    if (!in_array($categoria, $allowed, true)) {
        Http::error('invalid_category', 'Categoria invalida.', 422);
    }
    $label = trim((string) ($body['label_pt'] ?? ''));
    if ($label === '') {
        Http::error('invalid_label', 'Informe o rotulo em portugues.', 422);
    }
    $sub = trim((string) ($body['subcategoria'] ?? ''));

    Db::run(
        'UPDATE tags SET label_pt = ?, categoria = ?, subcategoria = ?, curated = 1 WHERE id = ?',
        [$label, $categoria, $sub, (int) $params['id']]
    );
    Http::json(['ok' => true]);
});

$router->add('GET', '#^/api/admin/uploads$#', static function (): void {
    Auth::requireUser();
    $rows = Db::all(
        'SELECT id, image_id, uuid, ip, bytes, ms, action, created_at
           FROM upload_log ORDER BY id DESC LIMIT 120'
    );
    Http::json(['items' => $rows]);
});

$router->add('POST', '#^/api/admin/sync-token$#', static function (): void {
    $token = Auth::rotateSyncToken();
    Http::json(['token' => $token]);
});

$router->add('GET', '#^/api/admin/settings$#', static function (): void {
    Auth::requireUser();
    $rows = Db::all('SELECT k, v FROM settings');
    $settings = [];
    foreach ($rows as $row) {
        $settings[$row['k']] = $row['v'];
    }
    unset($settings['sync_token_hash']);
    Http::json(['settings' => $settings]);
});

$router->add('POST', '#^/api/admin/settings$#', static function (): void {
    Auth::requireCsrf();
    $body = Http::jsonBody();
    $allowed = ['site_name', 'page_limit', 'privacy_blur'];
    foreach ($allowed as $key) {
        if (!array_key_exists($key, $body)) {
            continue;
        }
        $value = $body[$key];
        if ($key === 'page_limit') {
            $value = (string) max(12, min(96, (int) $value));
        } elseif ($key === 'privacy_blur') {
            $value = $value ? '1' : '0';
        } else {
            $value = mb_substr(trim((string) $value), 0, 80);
        }
        Db::run('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [$key, $value]);
    }
    Http::json(['ok' => true]);
});

// --------------------------------------------------------------------- sync

$router->add('GET', '#^/api/sync/ping$#', static function (): void {
    Auth::requireSyncToken();
    Http::json([
        'ok' => true,
        'version' => APP_VERSION,
        'php' => PHP_VERSION,
        'max_bytes' => Config::int('SYNC_MAX_BYTES', 20971520),
        'gd_webp' => function_exists('imagewebp'),
        'images' => (int) Db::value('SELECT COUNT(*) FROM images', [], 0),
        'server_time' => date('c'),
    ]);
});

$router->add('GET', '#^/api/sync/stats$#', static function (): void {
    Auth::requireSyncToken();
    Http::json([
        'ok' => true,
        'version' => APP_VERSION,
        'php' => PHP_VERSION,
        'gd_webp' => function_exists('imagewebp'),
        'max_bytes' => Config::int('SYNC_MAX_BYTES', 20971520),
        'server_time' => date('c'),
        'images' => (int) Db::value('SELECT COUNT(*) FROM images WHERE deleted_at IS NULL', [], 0),
        'trashed' => (int) Db::value('SELECT COUNT(*) FROM images WHERE deleted_at IS NOT NULL', [], 0),
        'favorites' => (int) Db::value('SELECT COUNT(*) FROM images WHERE favorite = 1 AND deleted_at IS NULL', [], 0),
        'bytes' => (int) Db::value('SELECT COALESCE(SUM(bytes), 0) FROM images WHERE deleted_at IS NULL', [], 0),
        'models' => (int) Db::value('SELECT COUNT(*) FROM models', [], 0),
        'loras' => (int) Db::value('SELECT COUNT(*) FROM loras', [], 0),
        'tags' => (int) Db::value('SELECT COUNT(*) FROM tags', [], 0),
        'last_image_at' => Db::value('SELECT MAX(created_at) FROM images', [], null),
        'pending_deletions' => (int) Db::value("SELECT COUNT(*) FROM local_deletions WHERE status = 'pending'", [], 0),
    ]);
});

$router->add('POST', '#^/api/sync/plan$#', static function (): void {
    Auth::requireSyncToken();
    $body = Http::jsonBody();
    $items = is_array($body['items'] ?? null) ? $body['items'] : [];
    if ($items === []) {
        Http::json(['missing' => [], 'known' => []]);
    }

    $shas = [];
    $uuids = [];
    foreach (array_slice($items, 0, 400) as $item) {
        if (!is_array($item)) {
            continue;
        }
        $sha = strtolower((string) ($item['sha256'] ?? ''));
        $uuid = strtolower((string) ($item['uuid'] ?? ''));
        if (preg_match('/^[a-f0-9]{64}$/', $sha) === 1) {
            $shas[$sha] = true;
        }
        if (Ingest::isValidUuid($uuid)) {
            $uuids[$uuid] = true;
        }
    }

    if ($shas === [] && $uuids === []) {
        Http::json(['missing' => [], 'known' => []]);
    }

    $knownShas = [];
    $knownUuids = [];
    if ($shas !== []) {
        $placeholders = implode(',', array_fill(0, count($shas), '?'));
        $rows = Db::all("SELECT sha256, uuid FROM images WHERE sha256 IN ($placeholders)", array_keys($shas));
        foreach ($rows as $row) {
            $knownShas[$row['sha256']] = $row['uuid'];
            $knownUuids[$row['uuid']] = true;
        }
    }
    if ($uuids !== []) {
        $placeholders = implode(',', array_fill(0, count($uuids), '?'));
        $rows = Db::all("SELECT uuid FROM images WHERE uuid IN ($placeholders)", array_keys($uuids));
        foreach ($rows as $row) {
            $knownUuids[$row['uuid']] = true;
        }
    }

    $missing = [];
    $known = [];
    foreach ($items as $item) {
        if (!is_array($item)) {
            continue;
        }
        $sha = strtolower((string) ($item['sha256'] ?? ''));
        $uuid = strtolower((string) ($item['uuid'] ?? ''));
        if (preg_match('/^[a-f0-9]{64}$/', $sha) !== 1 || !Ingest::isValidUuid($uuid)) {
            continue;
        }
        if (isset($knownShas[$sha]) || isset($knownUuids[$uuid])) {
            $known[] = $uuid;
        } else {
            $missing[] = ['uuid' => $uuid, 'sha256' => $sha];
        }
    }

    Http::json(['missing' => $missing, 'known' => $known]);
});

$router->add('POST', '#^/api/sync/upload$#', static function (): void {
    Auth::requireSyncToken();
    if (Http::method() !== 'POST') {
        Http::error('method_not_allowed', 'Metodo nao permitido.', 405);
    }
    $uuid = (string) ($_POST['uuid'] ?? '');
    $metadata = (string) ($_POST['metadata'] ?? '');
    $declared = strtolower((string) ($_POST['sha256'] ?? ''));

    if (!isset($_FILES['image']) || !is_array($_FILES['image'])) {
        Http::error('missing_file', 'Campo "image" ausente.', 422);
    }
    if ($declared !== '' && preg_match('/^[a-f0-9]{64}$/', $declared) === 1) {
        $actual = hash_file('sha256', (string) $_FILES['image']['tmp_name']);
        if ($actual === false || !hash_equals($declared, $actual)) {
            Http::error('hash_mismatch', 'SHA-256 do arquivo nao confere.', 422);
        }
    }

    $result = Ingest::fromUpload($_FILES['image'], $uuid, $metadata);
    Http::json($result, ($result['status'] ?? '') === 'created' ? 201 : 200);
});

$router->add('GET', '#^/api/sync/deletions$#', static function (): void {
    Auth::requireSyncToken();
    $rows = Db::all(
        "SELECT id, uuid, folder, requested_at
           FROM local_deletions
          WHERE status = 'pending'
          ORDER BY id ASC LIMIT 200"
    );
    Http::json(['items' => $rows]);
});

$router->add('POST', '#^/api/sync/deletions/(?P<id>\d+)/ack$#', static function (array $params): void {
    Auth::requireSyncToken();
    $body = Http::jsonBody();
    $status = ($body['status'] ?? 'acked') === 'failed' ? 'failed' : 'acked';
    Db::run(
        'UPDATE local_deletions SET status = ?, acked_at = NOW() WHERE id = ?',
        [$status, (int) $params['id']]
    );
    Http::json(['ok' => true, 'status' => $status]);
});

// ---------------------------------------------------------------- dispatch

$router->dispatch(Http::method(), $uri);

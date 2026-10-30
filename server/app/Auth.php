<?php
declare(strict_types=1);

final class Auth
{
    private const MAX_ATTEMPTS = 5;
    private const LOCK_WINDOW_MINUTES = 15;

    private static ?array $session = null;
    private static bool $sessionLoaded = false;

    // ---------------------------------------------------------------- sessao

    public static function cookieName(): string
    {
        return Http::isHttps() ? '__Host-anima_sess' : 'anima_sess';
    }

    public static function session(): ?array
    {
        if (self::$sessionLoaded) {
            return self::$session;
        }
        self::$sessionLoaded = true;

        $token = $_COOKIE[self::cookieName()] ?? null;
        if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/', $token)) {
            return null;
        }

        $row = Db::one(
            'SELECT s.id, s.user_id, s.csrf, s.expires_at, s.created_at, u.username, u.totp_secret
               FROM sessions s
               JOIN users u ON u.id = s.user_id
              WHERE s.id = ? LIMIT 1',
            [hash('sha256', $token)]
        );

        if ($row === null) {
            return null;
        }
        if (strtotime((string) $row['expires_at']) < time()) {
            Db::run('DELETE FROM sessions WHERE id = ?', [$row['id']]);
            return null;
        }

        self::$session = $row;
        self::touch((string) $row['id'], (string) $row['expires_at'], $token);

        return self::$session;
    }

    private static function touch(string $id, string $expiresAt, string $token): void
    {
        $ttl = max(1, Config::int('SESSION_TTL_DAYS', 30)) * 86400;
        $remaining = strtotime($expiresAt) - time();
        if ($remaining > $ttl - 172800) {
            return; // renova no maximo 1x por dia
        }
        $newExpires = date('Y-m-d H:i:s', time() + $ttl);
        Db::run('UPDATE sessions SET expires_at = ? WHERE id = ?', [$newExpires, $id]);
        self::setCookie($token, time() + $ttl);
    }

    private static function setCookie(string $token, int $expires): void
    {
        setcookie(self::cookieName(), $token, [
            'expires' => $expires,
            'path' => '/',
            'secure' => Http::isHttps(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }

    public static function user(): ?array
    {
        $session = self::session();
        if ($session === null) {
            return null;
        }
        return [
            'id' => (int) $session['user_id'],
            'username' => (string) $session['username'],
            'csrf' => (string) $session['csrf'],
            'two_factor' => $session['totp_secret'] !== null && $session['totp_secret'] !== '',
        ];
    }

    public static function me(): array
    {
        $user = self::user();
        if ($user === null) {
            Http::error('unauthorized', 'Sessao expirada. Entre novamente.', 401);
        }
        return [
            'user' => ['id' => $user['id'], 'username' => $user['username']],
            'csrf' => $user['csrf'],
            'settings' => [
                'site_name' => Db::value("SELECT v FROM settings WHERE k = 'site_name'", [], 'Galeria Anima'),
                'page_limit' => (int) Db::value("SELECT v FROM settings WHERE k = 'page_limit'", [], 48),
                'privacy_blur' => Db::value("SELECT v FROM settings WHERE k = 'privacy_blur'", [], '0') === '1',
                'sync_configured' => (string) Db::value("SELECT v FROM settings WHERE k = 'sync_token_hash'", [], '') !== '',
            ],
        ];
    }

    public static function requireUser(): array
    {
        $user = self::user();
        if ($user === null) {
            Http::error('unauthorized', 'Sessao expirada. Entre novamente.', 401);
        }
        return $user;
    }

    public static function requireCsrf(): void
    {
        $user = self::requireUser();
        $sent = Http::header('X-CSRF-Token') ?? '';
        if ($sent === '' || !hash_equals($user['csrf'], $sent)) {
            Http::error('csrf', 'Token CSRF invalido. Recarregue a pagina.', 419);
        }
    }

    // ---------------------------------------------------------------- login

    public static function login(string $username, string $password): array
    {
        $ip = Http::clientIp();
        $username = mb_substr(trim($username), 0, 64);

        if ($username === '' || $password === '') {
            Http::error('invalid_credentials', 'Informe usuario e senha.', 422);
        }

        self::assertNotLocked($ip, $username);

        $user = Db::one('SELECT * FROM users WHERE username = ? LIMIT 1', [$username]);
        $hash = $user['password_hash'] ?? '$2y$12$invalidoinvalidoinvalidoinvalidoinvalidoinvalidoinvalidoinvali';

        if (!password_verify($password, (string) $hash) || $user === null) {
            self::recordFailure($ip, $username);
            if ($user !== null) {
                $failed = (int) $user['failed_count'] + 1;
                $lockedUntil = $failed >= self::MAX_ATTEMPTS ? date('Y-m-d H:i:s', time() + self::LOCK_WINDOW_MINUTES * 60) : null;
                Db::run('UPDATE users SET failed_count = ?, locked_until = ? WHERE id = ?', [$failed, $lockedUntil, $user['id']]);
            }
            Http::error('invalid_credentials', 'Usuario ou senha invalidos.', 401);
        }

        if ($user['locked_until'] !== null && strtotime((string) $user['locked_until']) > time()) {
            Http::error('locked', 'Conta temporariamente bloqueada. Tente novamente em alguns minutos.', 429);
        }

        Db::run('DELETE FROM login_attempts WHERE ip = ? OR username = ?', [$ip, $username]);
        Db::run('UPDATE users SET failed_count = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?', [$user['id']]);

        $token = bin2hex(random_bytes(32));
        $csrf = bin2hex(random_bytes(32));
        $ttl = max(1, Config::int('SESSION_TTL_DAYS', 30)) * 86400;

        Db::insert(
            'INSERT INTO sessions (id, user_id, csrf, ip, user_agent, expires_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [
                hash('sha256', $token),
                $user['id'],
                $csrf,
                $ip,
                mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
                date('Y-m-d H:i:s', time() + $ttl),
            ]
        );

        self::setCookie($token, time() + $ttl);
        self::$sessionLoaded = true;
        self::$session = ['csrf' => $csrf, 'user_id' => $user['id'], 'username' => $user['username']];

        app_log('info', 'Login efetuado', ['user' => $username, 'ip' => $ip]);

        return ['user' => ['id' => (int) $user['id'], 'username' => (string) $user['username']], 'csrf' => $csrf];
    }

    public static function logout(): void
    {
        $token = $_COOKIE[self::cookieName()] ?? null;
        if (is_string($token) && $token !== '') {
            Db::run('DELETE FROM sessions WHERE id = ?', [hash('sha256', $token)]);
        }
        setcookie(self::cookieName(), '', [
            'expires' => time() - 3600,
            'path' => '/',
            'secure' => Http::isHttps(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        self::$session = null;
        self::$sessionLoaded = true;
    }

    private static function assertNotLocked(string $ip, string $username): void
    {
        $since = date('Y-m-d H:i:s', time() - self::LOCK_WINDOW_MINUTES * 60);
        $byIp = (int) Db::value(
            'SELECT COALESCE(SUM(attempts), 0) FROM login_attempts WHERE ip = ? AND last_at >= ?',
            [$ip, $since],
            0
        );
        $byUser = (int) Db::value(
            'SELECT COALESCE(SUM(attempts), 0) FROM login_attempts WHERE username = ? AND last_at >= ?',
            [$username, $since],
            0
        );
        if ($byIp >= 15 || $byUser >= self::MAX_ATTEMPTS) {
            app_log('warn', 'Login bloqueado por excesso de tentativas', ['ip' => $ip, 'user' => $username]);
            Http::error('too_many_attempts', 'Muitas tentativas. Aguarde 15 minutos.', 429);
        }
    }

    private static function recordFailure(string $ip, string $username): void
    {
        Db::run(
            'INSERT INTO login_attempts (ip, username, attempts, first_at, last_at)
             VALUES (?, ?, 1, NOW(), NOW())
             ON DUPLICATE KEY UPDATE attempts = attempts + 1, last_at = NOW()',
            [$ip, $username]
        );
    }

    public static function changePassword(string $current, string $new): void
    {
        $user = self::requireUser();
        $row = Db::one('SELECT password_hash FROM users WHERE id = ?', [$user['id']]);
        if ($row === null || !password_verify($current, (string) $row['password_hash'])) {
            Http::error('invalid_password', 'Senha atual incorreta.', 422);
        }
        if (mb_strlen($new) < 12) {
            Http::error('weak_password', 'A nova senha precisa ter ao menos 12 caracteres.', 422);
        }

        Db::run('UPDATE users SET password_hash = ? WHERE id = ?', [
            password_hash($new, PASSWORD_ARGON2ID),
            $user['id'],
        ]);

        $keep = $_COOKIE[self::cookieName()] ?? '';
        Db::run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [$user['id'], hash('sha256', (string) $keep)]);
        app_log('info', 'Senha alterada', ['user' => $user['username']]);
    }

    // ------------------------------------------------------------ sync token

    public static function requireSyncToken(): void
    {
        $header = Http::header('Authorization') ?? Http::header('X-Sync-Token') ?? '';
        $token = str_starts_with($header, 'Bearer ') ? substr($header, 7) : $header;
        $token = trim($token);

        $stored = (string) Db::value("SELECT v FROM settings WHERE k = 'sync_token_hash'", [], '');
        if ($stored === '') {
            Http::error('sync_not_configured', 'Token de sincronizacao nao configurado no painel.', 503);
        }
        if ($token === '' || !hash_equals($stored, hash('sha256', $token))) {
            app_log('warn', 'Token de sync invalido', ['ip' => Http::clientIp()]);
            Http::error('unauthorized', 'Token de sincronizacao invalido.', 401);
        }
    }

    public static function rotateSyncToken(): string
    {
        self::requireCsrf();
        $token = bin2hex(random_bytes(24));
        Db::run(
            "INSERT INTO settings (k, v) VALUES ('sync_token_hash', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)",
            [hash('sha256', $token)]
        );
        app_log('info', 'Token de sync rotacionado', ['ip' => Http::clientIp()]);
        return $token;
    }
}

<?php
declare(strict_types=1);

require dirname(__DIR__) . '/bootstrap.php';

if (PHP_SAPI !== 'cli') {
    exit("Este script deve rodar pela linha de comando.\n");
}

$username = $argv[1] ?? null;
$password = $argv[2] ?? null;

if ($username === null || trim($username) === '') {
    fwrite(STDERR, "Uso: php app/cli/create_admin.php <usuario> [senha]\n");
    exit(1);
}

if ($password === null) {
    fwrite(STDERR, "Senha (minimo 12 caracteres): ");
    $password = trim((string) fgets(STDIN));
}

if (mb_strlen((string) $password) < 12) {
    fwrite(STDERR, "A senha precisa ter ao menos 12 caracteres.\n");
    exit(1);
}

$username = mb_substr(trim((string) $username), 0, 64);
$hash = password_hash((string) $password, PASSWORD_ARGON2ID);

$existing = Db::one('SELECT id FROM users WHERE username = ?', [$username]);
if ($existing !== null) {
    Db::run(
        'UPDATE users SET password_hash = ?, failed_count = 0, locked_until = NULL WHERE id = ?',
        [$hash, $existing['id']]
    );
    Db::run('DELETE FROM sessions WHERE user_id = ?', [$existing['id']]);
    echo "Senha atualizada para o usuario '{$username}'. Sessoes antigas revogadas.\n";
} else {
    Db::run(
        'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, NOW())',
        [$username, $hash]
    );
    echo "Usuario '{$username}' criado.\n";
}

echo "Acesse /login e entre com a nova senha.\n";

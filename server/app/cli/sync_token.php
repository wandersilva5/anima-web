<?php
declare(strict_types=1);

require dirname(__DIR__) . '/bootstrap.php';

if (PHP_SAPI !== 'cli') {
    exit("Este script deve rodar pela linha de comando.\n");
}

$current = (string) Db::value("SELECT v FROM settings WHERE k = 'sync_token_hash'", [], '');

if (in_array('--show', $argv, true)) {
    echo $current === '' ? "Nenhum token configurado.\n" : "Token configurado (hash {$current}).\n";
    exit(0);
}

if ($current !== '' && !in_array('--force', $argv, true)) {
    fwrite(STDERR, "Ja existe um token. Use --force para gerar outro (o antigo deixa de funcionar).\n");
    exit(1);
}

$token = bin2hex(random_bytes(24));
Db::run(
    "INSERT INTO settings (k, v) VALUES ('sync_token_hash', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)",
    [hash('sha256', $token)]
);

echo "Novo SYNC_TOKEN (cole no app Anima Gallery Sync):\n{$token}\n";

<?php
declare(strict_types=1);

require dirname(__DIR__) . '/bootstrap.php';

if (PHP_SAPI !== 'cli') {
    exit("Este script deve rodar pela linha de comando.\n");
}

// Diretorios necessarios
Config::ensureDir(Config::storagePath('logs'));
Config::ensureDir(Config::mediaPath());
foreach (['o', 'd', 't'] as $variant) {
    Config::ensureDir(Config::mediaPath($variant));
}

$sqlFile = Config::path('db/schema.sql');
if (!is_file($sqlFile)) {
    fwrite(STDERR, "schema.sql nao encontrado em {$sqlFile}\n");
    exit(1);
}

$sql = (string) file_get_contents($sqlFile);
$pdo = Db::pdo();

$statements = array_filter(array_map('trim', explode(";\n", $sql)), static fn (string $s) => $s !== '');
$executed = 0;
foreach ($statements as $statement) {
    $pdo->exec($statement);
    $executed++;
}

echo "Schema aplicado: {$executed} comandos.\n";

// Token de sincronizacao inicial
$current = (string) Db::value("SELECT v FROM settings WHERE k = 'sync_token_hash'", [], '');
if ($current === '') {
    $token = bin2hex(random_bytes(24));
    Db::run(
        "INSERT INTO settings (k, v) VALUES ('sync_token_hash', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)",
        [hash('sha256', $token)]
    );
    echo "\nSYNC_TOKEN gerado (guarde e cole no app de sincronizacao):\n{$token}\n";
} else {
    echo "SYNC_TOKEN ja configurado (rotacione em Admin > Acesso).\n";
}

echo "\nResumo:\n";
foreach ([
    'imagens' => 'SELECT COUNT(*) FROM images',
    'modelos' => 'SELECT COUNT(*) FROM models',
    'loras' => 'SELECT COUNT(*) FROM loras',
    'tags' => 'SELECT COUNT(*) FROM tags',
    'usuarios' => 'SELECT COUNT(*) FROM users',
] as $label => $query) {
    echo sprintf("  %-10s %s\n", $label, Db::value($query, [], 0));
}

echo "\nCrie o admin com: php app/cli/create_admin.php <usuario> <senha>\n";

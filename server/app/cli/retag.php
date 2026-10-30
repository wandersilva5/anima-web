<?php
declare(strict_types=1);

require dirname(__DIR__) . '/bootstrap.php';

if (PHP_SAPI !== 'cli') {
    exit("Este script deve rodar pela linha de comando.\n");
}

echo "Recalculando tags de todas as imagens...\n";
$total = Ingest::retagAll(static function (int $done): void {
    echo "  {$done} imagens\n";
});

echo "Concluido: {$total} imagens reprocessadas.\n";
echo "Tags na base: " . Db::value('SELECT COUNT(*) FROM tags', [], 0) . "\n";
echo "Tags curadas: " . Db::value('SELECT COUNT(*) FROM tags WHERE curated = 1', [], 0) . "\n";

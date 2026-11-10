<?php
/**
 * Diagnóstico: verifica se os arquivos de mídia registrados no banco existem no disco.
 *
 * Uso remoto: https://seusite.com/anima/anima/app/cli/check_media.php
 * Uso local:  php tools/teste-midia.php
 *
 * Saída JSON com a lista de imagens cujos arquivos estão ausentes.
 */
declare(strict_types=1);

// Quando executado via CLI local, ajusta o autoload
$bootstrapCandidates = [
    __DIR__ . '/../server/app/bootstrap.php',
    dirname(__DIR__) . '/server/app/bootstrap.php',
];
$found = false;
foreach ($bootstrapCandidates as $path) {
    if (is_file($path)) {
        require_once $path;
        $found = true;
        break;
    }
}
if (!$found) {
    fwrite(STDERR, "bootstrap.php nao encontrado.\n");
    exit(1);
}

$rows = Db::all(
    'SELECT uuid, path_orig, path_disp, path_thumb, sha256
       FROM images
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC'
);

$missing = [];
$ok = 0;

foreach ($rows as $row) {
    $problems = [];

    $origPath = Config::mediaPath($row['path_orig']);
    $dispPath = Config::mediaPath($row['path_disp']);
    $thumbPath = Config::mediaPath($row['path_thumb']);

    if (!is_file($origPath)) {
        $problems[] = 'orig';
    }
    // display pode apontar para o original (quando < DISPLAY_MAX)
    if ($row['path_disp'] !== $row['path_orig'] && !is_file($dispPath)) {
        $problems[] = 'disp';
    }
    if (!is_file($thumbPath)) {
        $problems[] = 'thumb';
    }

    if ($problems !== []) {
        $missing[] = [
            'uuid' => $row['uuid'],
            'sha256' => $row['sha256'],
            'missing' => $problems,
            'paths' => [
                'orig' => $row['path_orig'],
                'disp' => $row['path_disp'],
                'thumb' => $row['path_thumb'],
            ],
        ];
    } else {
        $ok++;
    }
}

$result = [
    'total' => count($rows),
    'ok' => $ok,
    'broken' => count($missing),
    'media_dir' => Config::mediaPath(),
    'items' => $missing,
];

if (PHP_SAPI === 'cli') {
    echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    if ($missing !== []) {
        fwrite(STDERR, "\n⚠ " . count($missing) . " imagem(ns) com arquivos ausentes no disco!\n");
        exit(1);
    }
    echo "✓ Todas as " . $ok . " imagens estao integras.\n";
} else {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

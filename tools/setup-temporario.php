<?php
declare(strict_types=1);

/**
 * Instalacao temporaria do servidor novo (sem SSH), conforme o Anexo do
 * MIGRAR-HOSPEDAGEM.md. Copie este arquivo para o webroot da galeria
 * (htdocs/anima/) HOJE COM O NOME SORTEADO, abra o endereco no navegador,
 * preenha usuario e senha, envie — ele aplica o schema, gera o SYNC_TOKEN,
 * cria o admin e SE APAGA ao final.
 *
 * Depois: confirme abrindo o endereco de novo (tem que dar 404) e apague
 * qualquer copia que tenha sobrado no PC.
 *
 * Protecao: o proprio nome do arquivo e o token de acesso (48 hex) e o
 * arquivo se remove apos concluir. Ele roda apenas se achar o codigo
 * privado da galeria no lugar esperado.
 */

$nome = basename($_SERVER['SCRIPT_NAME'] ?? '');
if (preg_match('/^setup-[0-9a-f]{48}\.php$/', $nome) !== 1) {
    http_response_code(404);
    exit;
}

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
header('X-Content-Type-Options: nosniff');

$candidatos = [
    dirname(__DIR__, 2) . '/anima/app/bootstrap.php', // codigo fora do docroot (preferido)
    __DIR__ . '/anima/app/bootstrap.php',            // codigo dentro de htdocs/anima (FTP preso)
];
$bootstrap = null;
foreach ($candidatos as $caminho) {
    if (is_file($caminho)) {
        $bootstrap = $caminho;
        break;
    }
}
if ($bootstrap === null) {
    http_response_code(500);
    echo 'Codigo do servidor nao encontrado. Rode o deploy.ps1 antes deste passo.';
    exit;
}
require $bootstrap;

$titulo = 'Setup Galeria Anima';
$erro = null;
$ok = null;

function esc(?string $v): string
{
    return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $usuario = trim((string) ($_POST['usuario'] ?? ''));
    $senha = (string) ($_POST['senha'] ?? '');

    try {
        // 1) schema (idempotente, como o migrate.php)
        $sqlFile = Config::path('db/schema.sql');
        if (!is_file($sqlFile)) {
            throw new RuntimeException('schema.sql nao encontrado em ' . $sqlFile);
        }
        $sql = (string) file_get_contents($sqlFile);
        $statements = array_filter(array_map('trim', explode(";\n", $sql)), static fn (string $s): bool => $s !== '');
        $pdo = Db::pdo();
        foreach ($statements as $statement) {
            $pdo->exec($statement);
        }

        // 2) token de sincronizacao (gera so se nao existir)
        $token = null;
        $atual = (string) Db::value("SELECT v FROM settings WHERE k = 'sync_token_hash'", [], '');
        if ($atual === '') {
            $token = bin2hex(random_bytes(24));
            Db::run(
                "INSERT INTO settings (k, v) VALUES ('sync_token_hash', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)",
                [hash('sha256', $token)]
            );
        }

        // 3) admin
        if ($usuario === '' || mb_strlen($senha) < 12) {
            throw new RuntimeException('Informe o usuario e uma senha de ao menos 12 caracteres.');
        }
        $usuario = mb_substr($usuario, 0, 64);
        $algo = (in_array('argon2id', password_algos(), true)) ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
        $hash = password_hash($senha, $algo);

        $existente = Db::one('SELECT id FROM users WHERE username = ?', [$usuario]);
        if ($existente !== null) {
            Db::run(
                'UPDATE users SET password_hash = ?, failed_count = 0, locked_until = NULL WHERE id = ?',
                [$hash, (int) $existente['id']]
            );
            Db::run('DELETE FROM sessions WHERE user_id = ?', [(int) $existente['id']]);
        } else {
            Db::run(
                'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, NOW())',
                [$usuario, $hash]
            );
        }

        $contagens = [
            'tabelas' => (int) Db::value('SELECT COUNT(DISTINCT TABLE_NAME) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()', [], 0),
            'usuarios' => (int) Db::value('SELECT COUNT(*) FROM users', [], 0),
            'imagens' => (int) Db::value('SELECT COUNT(*) FROM images', [], 0),
        ];

        // 4) se apaga
        if (!@unlink(__FILE__)) {
            throw new RuntimeException('Instalacao concluida, mas nao consegui apagar este arquivo. Apague-o manualmente pelo painel/FTP.');
        }

        // raiz do codigo privado (ex.: .../dominio/anima) — daqui saem os caminhos absolutos
        $privRoot = dirname(dirname($bootstrap));
        $ok = [
            'schema' => $contagens['tabelas'] . ' tabelas aplicadas',
            'admin' => "usuario '{$usuario}' pronto (sessoes antigas revogadas)",
            'token' => $token,
            'storage' => $privRoot . '/storage',
            'media' => __DIR__ . '/media',
        ];
    } catch (Throwable $e) {
        $erro = $e->getMessage();
    }
}

if ($ok !== null) {
    echo '<h1>' . esc($titulo) . ' — concluído</h1>';
    echo '<ul>';
    echo '<li>Schema: ' . esc($ok['schema']) . '</li>';
    echo '<li>Admin: ' . esc($ok['admin']) . '</li>';
    if ($ok['token'] !== null) {
        echo '<li><strong>SYNC_TOKEN (guarde agora, só aparece uma vez):</strong><br><code>' . esc($ok['token']) . '</code></li>';
    } else {
        echo '<li>SYNC_TOKEN já existia no banco (rotacione em Admin > Painel depois do login).</li>';
    }
    echo '<li>Arquivo de setup <strong>apagado</strong> — recarregar esta página deve dar 404.</li>';
    echo '<li><strong>Cole no <code>server/.env</code> e reenvie com <code>-UploadEnv</code>:</strong><br>';
    echo '<code>STORAGE_DIR=' . esc($ok['storage']) . '</code><br>';
    echo '<code>MEDIA_DIR=' . esc($ok['media']) . '</code></li>';
    echo '</ul>';
    echo '<p>Próximos passos: entrar em <code>/anima/login</code> e colar o token no painel (painel.bat).</p>';
    exit;
}

$erroHtml = $erro !== null ? '<div class="erro">' . esc($erro) . '</div>' : '';

$form = <<<HTML
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{$titulo}</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0b0d10;color:#e4e4e7;display:grid;place-items:center;min-height:100vh;margin:0}
  form{background:#14161a;padding:28px;border-radius:12px;width:min(92vw,360px);display:grid;gap:12px}
  h1{font-size:1.15rem;margin:0 0 4px}
  label{font-size:.85rem;color:#a1a1aa;display:grid;gap:4px}
  input{padding:10px;border-radius:8px;border:1px solid #2a2d33;background:#0b0d10;color:#e4e4e7;font-size:1rem}
  button{padding:11px;border:0;border-radius:8px;background:#2f81f7;color:#fff;font-size:.95rem;cursor:pointer}
  .erro{background:#3b1418;border:1px solid #7f1d1d;padding:10px;border-radius:8px;font-size:.9rem}
  p{font-size:.85rem;color:#a1a1aa;margin:0}
</style>
</head>
<body>
<form method="post" action="">
  <h1>{$titulo}</h1>
  <p>Aplica o schema, gera o SYNC_TOKEN, cria o admin e apaga este arquivo.</p>
  {$erroHtml}
  <label>Usuário do admin
    <input name="usuario" autocomplete="username" required maxlength="64">
  </label>
  <label>Senha (mínimo 12 caracteres)
    <input name="senha" type="password" autocomplete="new-password" required minlength="12">
  </label>
  <button type="submit">Instalador — executar e apagar</button>
</form>
</body>
</html>
HTML;

echo $form;
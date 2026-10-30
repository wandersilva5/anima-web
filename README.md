# Galeria Anima

Galeria privada para as imagens geradas pelo **Anima** (app local em Electron). O acervo fica no
servidor, protegido por login, e é alimentado por um painel de sincronização que roda no seu PC.

- Produção: https://femipro.trustchoicereviews.com
- Modelo: uma galeria por instalação, com usuário administrador único (sem cadastro público).

---

## Como está dividido

```
  Anima (gerador)          painel.bat                site no servidor
  E:\...\history   --->    sync/ (Electron)   --->   server/ (PHP)  <---  app/ (React SPA)
        originais          só envia o que falta         API + MySQL         navegador
```

| Pasta | O que é | Stack |
|---|---|---|
| `app/` | Frontend (SPA/PWA): galeria, busca por tags, favoritos, visualizador, admin | React 18, Vite 5, TypeScript, Tailwind |
| `server/` | Backend: API JSON, autenticação por sessão, ingestão e derivadas das imagens | PHP 8.2+ (sem framework), MySQL/MariaDB |
| `sync/` | Painel local que envia o histórico para o servidor | Electron 32, TypeScript |
| `shared/` | Taxonomia de tags bilingue usada pelo frontend e pelo backend | JSON |
| `tools/` | Publicação e utilitários (`deploy.ps1`) | PowerShell |
| `.bat` (raiz) | Atalhos: `iniciar.bat`, `painel.bat`, `publicar.bat` | Batch |

O build do frontend **não** é servido por `app/`: o Vite compila direto para `server/public/`,
que é o único webroot.

---

## Requisitos

- Node.js 18+
- PHP 8.2+ com `gd` (WebP) e `pdo_mysql`
- MySQL 5.7+ ou MariaDB
- Windows para os `.bat` (o restante é portável: PHP e Node rodam em Linux/macOS)

Se o `php.exe` não estiver no `PATH`, defina uma vez:

```powershell
setx ANIMA_PHP "C:\xampp\php\php.exe"
```

---

## Rodando localmente

```bat
iniciar.bat          :: usa o build que já está em server\public
iniciar.bat build    :: roda o build do frontend antes de subir
iniciar.bat dev      :: Vite com hot reload (5173) + API PHP (8080)
iniciar.bat sync     :: abre também o painel de sincronização
iniciar.bat setup    :: aplica o schema e cria o usuário admin
```

No primeiro uso, `iniciar.bat` cria `server/.env` a partir de `server/.env.example`,
abre no bloco de notas e espera você preencher `DB_*`.

Modo manual, se preferir:

```powershell
cd app; npm install; npm run dev        # http://localhost:5173 (proxy /api e /media -> 8080)

php -S 127.0.0.1:8080 -t server/public server/public/index.php
```

Build do frontend:

```powershell
cd app; npm run build                   # tsc --noEmit && vite build -> server/public
```

---

## Banco de dados

Schema em `server/db/schema.sql`. Tabelas: `users`, `sessions`, `images`, `models`, `loras`,
`image_loras`, `tags`, `image_tags`, `local_deletions`, `upload_log`, `login_attempts`, `settings`.

Scripts de CLI (`PHP_SAPI` de linha de comando):

```bash
php server/app/cli/migrate.php                 # aplica o schema (idempotente)
php server/app/cli/create_admin.php USUARIO [SENHA]  # cria/troca a senha do admin
php server/app/cli/sync_token.php              # gera/rotaciona o token do painel
php server/app/cli/retag.php                   # reprocessa as tags do acervo
```

---

## API

Tudo trafega JSON em `/api`, exceto as mídias.

| Grupo | Rotas | Proteção |
|---|---|---|
| Saúde | `GET /api/health` | pública |
| Sessão | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/admin/password` | login é público; o resto exige sessão |
| Acervo | `GET /api/images`, `GET /api/images/{uuid}`, `POST /api/images/{uuid}/favorite`, `POST /api/images/{uuid}/delete` | sessão |
| Filtros | `GET /api/facets`, `GET /api/dictionary`, `GET /api/search/tags`, `GET /api/stats` | sessão |
| Lixeira | `GET /api/admin/trash`, `POST /api/admin/images/{uuid}/restore` | sessão |
| Sincronização | `POST /api/sync/plan`, `POST /api/sync/upload`, `GET /api/sync/stats`, `GET /api/sync/ping`, `GET /api/sync/deletions`, `POST /api/sync/deletions/{id}/ack` | Bearer token |
| Mídia | `GET /media/{o,d,t}/aa/bb/<sha256>.<ext>` | **sessão** |

Requisições que alteram dados (`POST`) também exigem o cabeçalho `X-CSRF-Token` com o valor
devolvido por `/api/auth/me`.

As imagens **não** são servidas como arquivo estático: o `.htaccess` manda `/media/*` para o
front controller, que valida a sessão antes de entregar o arquivo. Sem login, a resposta é `401`.

---

## Painel de sincronização

```bat
painel.bat
```

- Configuração em `%APPDATA%\anima-gallery-sync\config.json` (`baseUrl`, `tokenPlain`,
  `historyDir`, `trashDir`, `concurrency`).
- O token é gerado em **Admin → Painel** no site.
- Envio **incremental**: varre a pasta `history`, calcula SHA-256 apenas do que é novo ou mudou
  (estado em `%APPDATA%\anima-gallery-sync\state.json`), pergunta ao servidor o que falta
  (`/api/sync/plan`) e envia só isso. Reexecutar é seguro: o servidor deduplica por SHA-256/uuid.
- Apagar um arquivo local **não** apaga no site: entra em uma fila de exclusão pendente, que você
  confirma no painel ("Aplicar N exclusões").

---

## Publicação (deploy)

```bat
publicar.bat
```

Equivale a:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\deploy.ps1" -Build
```

- Configuração em `tools/deploy.config.json` (fora do Git): `host`, `port`, `tls`, `user`,
  `password`, `remotePublic`, `remotePrivate`.
- Envia `server/public/*` → `remotePublic`, e `server/app` + `server/db` → `remotePrivate`.
- **Nunca** envia nem apaga `media/` (dados) e `storage/` (logs/sessões).
- Incremental por SHA-256 (`tools/.deploy-state.json`). Flags úteis:

| Flag | Efeito |
|---|---|
| `-DryRun` | mostra o que seria enviado |
| `-Force` | reenvia tudo (necessário em servidor novo) |
| `-UploadEnv` | inclui o `server/.env` (por padrão ele nunca é tocado) |
| `-Build` | roda o build do frontend antes de enviar |

---

## Segurança

- `server/.env`, `tools/deploy.config.json`, `tools/.deploy-state.json`, `media/`, `storage/`,
  `node_modules/` e builds nunca são versionados (ver `.gitignore`).
- Sessão por cookie `HttpOnly` + `SameSite=Lax` (e `Secure` quando o site está em HTTPS), com
  expiração configurável; APIs respondem `no-store`.
- Mídia sempre autenticada e com cache `private` (nunca em cache compartilhado).
- Código privado em `/anima` bloqueado pelo `.htaccess`; `.env` e logs retornam `403`.
- Cabeçalhos aplicados em toda resposta: CSP, HSTS, `X-Frame-Options`, `Referrer-Policy`,
  `X-Robots-Tag: noindex`.
- Login com limite de tentativas por IP/usuário (`login_attempts`).

---

## Convenções do projeto

- Respostas da API e mensagens de interface em **português (pt-BR)**.
- Comentários de código em português **sem acentos** (compatível com qualquer encoding).
- Nomes de tabelas, rotas e variáveis em inglês; textos de tela em português.
- Sem framework no backend: `Router`, `Http`, `Db`, `Auth`, `Media` são classes pequenas e
  explícitas em `server/app/`.

---

## Documentação complementar

O passo a passo de migração para outra hospedagem (checklist de campos, backup do banco,
transferência de mídia e testes de aceite) fica em `MIGRAR-HOSPEDAGEM.md` — arquivo local,
mantido **fora do Git** por descrever servidor, banco e caminhos internos.

---

Uso pessoal. Sem licença de distribuição.

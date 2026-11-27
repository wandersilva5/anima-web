# Pendências — Galeria Anima

> Atualizado em 27/11/2026. Ordenado por prioridade.

---

## 1. ~~BLOQUEADOR: upload dos GIFs~~ — RESOLVIDO: funcionalidade de GIF REMOVIDA

**Decisão (27/11/2026):** remover envio e visualização de GIFs (frontend, painel e
backend). Motivo: o hosting InfinityFree free tem limite rígido de **10 MB por
arquivo** (nível de filesystem) e disco de ~5 GB — os 119 GIFs de `F:\uv` somam
**7,89 GB** (mínimo >20 MB). Nenhum GIF subiu (0 de 119), e a opção "E" do
quadro abaixo virou a escolhida.

**O que foi removido:**

- Frontend: rota/aba `/gifs` (`Gifs.tsx`), badge `GIF` no grid e no visualizador,
  filtro `gif` nos `Filters`, campo `is_gif`.
- Painel (`sync/`): campo **"Pasta GIF"** no form, `gifDir` no config, varredura
  de GIFs soltos/sintéticos no `scanner.ts`, contadores `[GIF]` no log.
- Backend (`server/app/`): `IMAGETYPE_GIF` fora de `Ingest`, `Media` (load/rotate/
  storeOriginal) e filtro `gif` de `Images.php`.

**Ainda vale (erro de upload grande em geral):** em `server/public/index.php`,
antes de reportar `missing_file`, checa-se se `$_POST` veio vazio (sinal de
`post_max_size` estourado) e responde `payload_too_large` 413. **Precisa ser
publicado** (`publicar.bat`) para valer em produção.

**Melhoria opcional no cliente:** o painel lê `max_bytes` do `/api/sync/ping` mas
não usa para nada — vale pular (com log claro) antes de mandar uploads que vão falhar.

### Registro do problema (histórico)

```
Falha ao enviar 美羽香　騎乗位差分.gif (...): Campo "image" ausente.
```

Causa: corpo do POST > `post_max_size` → PHP zera `$_POST` **e** `$_FILES` →
`server/public/index.php` vê `$_FILES['image']` vazio e reporta `missing_file`.
Campo `image` do cliente (`sync/src/api.ts`) sempre esteve correto.

| Fato | Valor |
|---|---|
| GIFs em `F:\uv` | **119 arquivos, 7,89 GB** (mín. >20 MB; máx. 109 MB) |
| Limite rígido do InfinityFree (free) | **10 MB por arquivo** |
| `SYNC_MAX_BYTES` (app) | 20 MB (`server/.env`) |

Se um dia quiser retomar: opções A (reduzir <10 MB), B (MP4/WebM), C (R2 fora),
D (hospedagem paga) — o disco free (~5 GB) não comporta 7,89 GB de qualquer jeito.

---

## 2. ~~BUG LATENTE: GIF perde animação~~ — RESOLVIDO com a remoção

O ramo `IMAGETYPE_GIF` de `Media::storeOriginal()` (reencodava via GD e matava a
animação) foi removido junto com o resto da funcionalidade. Não há mais aceitação
de GIF no servidor.

---

## 3. Arquivos críticos restaurados no repo (precisa commitar)

O commit `487c477` ("teste: mais um teste", 18/11) **apagou** do repositório:

- `server/public/index.php` (545 linhas — front controller: rotas da API + SPA fallback)
- `server/public/.htaccess` (58 linhas — rewrite, HTTPS, bloqueio de `/app`)
- `server/public/robots.txt`

No servidor eles **ainda existem** (verificado por FTP: `/wsengenhariadigital.com.br/htdocs/anima/`
contém `.htaccess`, `index.php`, `robots.txt`), por isso o site segue no ar.
Mas qualquer deploy limpo (hosting nova, restauração) quebraria tudo.

**Feito hoje:** restaurados de `487c477^` e já staged.
**Falta:** `git commit` (não commito sem pedido explícito).

---

## 4. Nome de arquivo com caracteres CJK/espacos (FTP 553)

`美羽香　騎乗位差分.gif` e similares dão erro 553 no FTP ("Nome de arquivo não
permitido") em alguns servidores (eram os GIFs; o mesmo vale para qualquer
arquivo com nome exótico).

**Correção sugerida:** sanitizar o nome no upload — manter o UUID no caminho no
disco (já é assim: `o/<shard>/<sha256>.<ext>`) e guardar o nome original só como
metadado. Se algum lugar ainda usa o nome original em path, normalizar para
ASCII/URL-encode.

---

## 5. Itens Cloudflare (baixa prioridade)

- **Não usar `wrangler deploy` neste projeto** — regra já documentada em
  `wrangler.toml` e no README. Cloudflare só proxy/DNS.
- O projeto **Workers `anima-web`** e o **Pages `wsengenhariadigital-com-br`**
  são órfãos: o Pages só tem `wsengenhariadigital-com-br.pages.dev`, sem domínio.
  O domínio real `wsengenhariadigital.com.br` é uma **zone** própria (id
  `1b8a1aac9265e1c07592fc07255ef258`) com A record proxied → `185.27.134.95`
  (InfinityFree). **Não precisa adicionar domínio a lugar nenhum.**
  → Perguntar ao usuário se pode excluir os projetos órfãos.
- Build do `anima-web` no painel nunca detectava mudanças de código (hash igual).
  Irrelevante enquanto a regra for "deploy via FTP".

---

## Checklist rápido de deploy (referência)

```bat
publicar.bat        :: frontend + backend via FTPS (tools/deploy.ps1 -Build)
```

- Frontend: `npm run build` em `app/` → sai em `server/public/`
- Backend: `server/app/*` → `/wsengenhariadigital.com.br/htdocs/anima/anima/app`
  (ou `deploy_backend.ps1`)
- `server/.env` **nunca** é enviado por padrão (`-UploadEnv` para forçar)
- Sync (painel): `painel.bat` → config em `%APPDATA%\anima-gallery-sync\config.json`
  (`historyDir`, `baseUrl`, token cifrado com safeStorage)

## Comandos úteis

```powershell
# estado do sync (só contém uploads bem-sucedidos)
Get-Content "$env:APPDATA\anima-gallery-sync\state.json" -Raw | ConvertFrom-Json

# health da API (passa pelo WAF do InfinityFree)
Invoke-WebRequest "https://wsengenhariadigital.com.br/anima/api/health" -UseBasicParsing
```

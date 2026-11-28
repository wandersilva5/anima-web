// Worker da Galeria Anima.
//
// O que ela faz em https://wsengenhariadigital.com.br/anima/*:
//   1. /anima/api/*, /anima/media/* e *.php -> PROXY para a origem
//      InfinityFree (la continua o PHP 8.2 + MySQL);
//   2. codigo (.htaccess) e arquivos ocultos -> 403 (mesma regra do servidor);
//   3. todo o resto -> bundle estatico de server/public, com fallback do
//      index.html para as rotas do React (SPA).
//
// IMPORTANTE sobre o proxy: a rota da Worker cobre apenas o hostname
// "wsengenhariadigital.com.br" + /anima/*, entao o fetch e feito para
// "www.wsengenhariadigital.com.br" (mesma origem via CNAME) para NAO reentrar
// nesta Worker e criar um loop infinito. Se a origem um dia deixar de servir
// o hostname "www", troque ORIGIN abaixo.

const ORIGIN = "https://www.wsengenhariadigital.com.br";
const BASE = "/anima";

function proxyParaOrigem(request, url) {
  const alvo = new URL(url.pathname + url.search, ORIGIN);
  return fetch(new Request(alvo, request));
}

function negar() {
  return new Response("403 Forbidden", { status: 403 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const caminho = url.pathname;

    // Fora do prefixo /anima (ex.: raiz do dominio) entrega o asset direto.
    if (caminho !== BASE && !caminho.startsWith(BASE + "/")) {
      return env.ASSETS.fetch(request);
    }

    let sub = caminho.slice(BASE.length);
    if (!sub.startsWith("/")) sub = "/" + sub;

    // Backend e midias: PHP/MySQL continuam na origem.
    if (sub === "/api" || sub.startsWith("/api/")) return proxyParaOrigem(request, url);
    if (sub.startsWith("/media/")) return proxyParaOrigem(request, url);
    if (sub.endsWith(".php")) return proxyParaOrigem(request, url);

    // Espelha a protecao do .htaccess do servidor.
    if (sub.startsWith("/app/") || sub.startsWith("/storage/")) return negar();
    if (sub.includes("/.")) return negar();

    const alvo = new URL(sub + url.search, url.origin);
    let res = await env.ASSETS.fetch(new Request(alvo, request));

    // Fallback da SPA: rota desconhecida devolve o index.html.
    // Busca "/" e nao "/index.html": o assets padrao redireciona
    // /index.html -> / (307), o que mandaria o visitante para a raiz do dominio.
    if (res.status === 404 || res.status === 301 || res.status === 302 || res.status === 307 || res.status === 308) {
      res = await env.ASSETS.fetch(new Request(new URL("/", url.origin), request));
    }

    return res;
  }
};

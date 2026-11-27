'use strict';

/**
 * Painel local: conexao com a producao, numeros do acervo, botao de
 * sincronizacao e retorno da execucao. Nenhuma imagem e exibida aqui.
 */

const api = window.syncApi;
const $ = (id) => document.getElementById(id);
const num = new Intl.NumberFormat('pt-BR');
const dtf = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const TIME_PREFIX = /^\d{2}:\d{2}:\d{2} /;

const app = { config: null, busy: false, ticker: null, startedAt: 0 };

// ------------------------------------------------------------------ formato

function clock() {
  return new Date().toTimeString().slice(0, 8);
}

function bytes(value) {
  const n = Number(value) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = n / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const digits = size >= 100 ? 0 : 1;
  return `${size.toFixed(digits).replace('.', ',')} ${units[index]}`;
}

function stamp(value) {
  if (!value) return '—';
  const raw = String(value);
  const date = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? raw : dtf.format(date);
}

function elapsed(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

function shortError(error) {
  const raw = String((error && error.message) || error || 'Falhou.');
  const match = raw.match(/Error:\s*(.+)$/);
  return (match ? match[1] : raw).replace(/\s+/g, ' ').trim();
}

// --------------------------------------------------------------------- log

function log(text, level = 'info') {
  const list = $('log');
  const line = document.createElement('li');
  line.className = level;
  line.textContent = TIME_PREFIX.test(String(text)) ? String(text) : `${clock()} ${text}`;
  list.prepend(line);
  while (list.children.length > 200) list.lastElementChild.remove();
}

function setConn(kind, text) {
  $('dot').className = `dot ${kind}`;
  $('connText').textContent = text;
  $('connText').title = text;
}

function hint(text, kind = '') {
  $('cfgHint').textContent = text;
  $('cfgHint').className = `hint ${kind}`.trim();
}

// ------------------------------------------------------------- renderizacao

function renderStats(stats) {
  const host = $('kSite');
  host.textContent = (app.config && app.config.baseUrl) || 'não configurado';
  host.title = host.textContent;

  if (!stats) {
    for (const id of ['kVersion', 'kPhp', 'kLatency', 'kTime', 'sImages', 'sFav', 'sTrash', 'sBytes', 'sModels', 'sLoras', 'sTags', 'sLast']) {
      $(id).textContent = '—';
    }
    const button = $('deletes');
    button.hidden = true;
    return;
  }

  $('kVersion').textContent = `${stats.version} · ${stats.gd_webp ? 'WebP ok' : 'sem WebP'}`;
  $('kPhp').textContent = stats.php;
  $('kLatency').textContent = `${num.format(stats.latency_ms)} ms`;
  $('kTime').textContent = stamp(stats.server_time);

  $('sImages').textContent = num.format(stats.images);
  $('sFav').textContent = num.format(stats.favorites);
  $('sTrash').textContent = num.format(stats.trashed);
  $('sBytes').textContent = bytes(stats.bytes);
  $('sModels').textContent = num.format(stats.models);
  $('sLoras').textContent = num.format(stats.loras);
  $('sTags').textContent = num.format(stats.tags);
  $('sLast').textContent = stamp(stats.last_image_at);

  const pending = Number(stats.pending_deletions) || 0;
  const button = $('deletes');
  button.hidden = pending === 0;
  button.textContent = `Aplicar ${num.format(pending)} ${pending > 1 ? 'exclusões' : 'exclusão'}`;
}

function renderLocal(preview) {
  if (!preview) {
    for (const id of ['lLocal', 'lSynced', 'lPending', 'lBytes', 'lLastSync']) $(id).textContent = '—';
    $('lFolder').textContent = (app.config && app.config.historyDir) || 'não configurada';
    return;
  }

  $('lLocal').textContent = num.format(preview.local);
  $('lSynced').textContent = num.format(preview.synced);
  $('lPending').textContent = num.format(preview.changed);
  $('lBytes').textContent = bytes(preview.bytes);
  $('lLastSync').textContent = preview.lastSync ? stamp(preview.lastSync) : 'nunca';
  $('lFolder').textContent = (app.config && app.config.historyDir) || '—';
  $('lFolder').title = $('lFolder').textContent;
}

function setBusy(on) {
  app.busy = on;
  $('sync').disabled = on;
  $('dry').disabled = on;
  $('refresh').disabled = on;
  $('deletes').disabled = on;
  $('cancel').hidden = !on;
  $('sync').textContent = on ? 'Sincronizando…' : 'Sincronizar agora';
}

// -------------------------------------------------------------- progresso

function percentOf(progress) {
  if (progress.phase === 'done') return 100;
  if (progress.phase === 'upload' && progress.total > 0) return (progress.done / progress.total) * 100;
  if (progress.phase === 'hash' && progress.total > 0) return (progress.hashed / progress.total) * 100;
  return null;
}

function renderProgress(progress) {
  $('phase').textContent = progress.message || '—';

  const sent = Math.max(0, (progress.done || 0) - (progress.failed || 0));
  $('cUp').textContent = num.format(sent);
  $('cFail').textContent = num.format(progress.failed || 0);
  $('cBytes').textContent = bytes(progress.bytes || 0);

  const percent = percentOf(progress);
  $('bar').classList.toggle('indeterminate', percent === null);
  $('barFill').style.width = percent === null ? '35%' : `${Math.min(100, percent).toFixed(1)}%`;

  if (progress.phase === 'done' || progress.phase === 'cancelled' || progress.phase === 'error') {
    $('bar').classList.remove('indeterminate');
  }
}

function resetRun() {
  $('phase').textContent = 'Preparando…';
  $('cUp').textContent = '0';
  $('cFail').textContent = '0';
  $('cBytes').textContent = '0 B';
  $('cTime').textContent = '0s';
  $('bar').classList.remove('indeterminate');
  $('barFill').style.width = '0%';
}

// ------------------------------------------------------------------ acoes

async function refresh() {
  $('refresh').disabled = true;
  setConn('idle', 'Verificando conexão…');

  try {
    const stats = await api.stats();
    renderStats(stats);
    setConn('ok', `Conectado · ${num.format(stats.images)} imagens · ${num.format(stats.latency_ms)} ms`);
  } catch (error) {
    renderStats(null);
    setConn('bad', shortError(error));
  }

  try {
    renderLocal(await api.preview());
  } catch (error) {
    renderLocal(null);
    log(shortError(error), 'warn');
  }

  $('refresh').disabled = app.busy;
}

async function startSync(dryRun) {
  if (app.busy) return;

  setBusy(true);
  resetRun();
  app.startedAt = Date.now();
  app.ticker = setInterval(() => {
    $('cTime').textContent = elapsed(Date.now() - app.startedAt);
  }, 500);

  log(dryRun ? 'Simulação iniciada (nada será enviado).' : 'Sincronização iniciada.');

  try {
    const summary = dryRun ? await api.dryRun() : await api.sync();
    if (dryRun) {
      log(`${num.format(summary.missing)} imagem(ns) pendente(s) de ${num.format(summary.scanned)} na pasta.`, 'warn');
      $('phase').textContent = `Simulação concluída: ${num.format(summary.missing)} imagem(ns) para enviar.`;
    } else {
      log(
        `Concluído: ${num.format(summary.uploaded)} enviada(s), ${num.format(summary.failed)} falha(s) em ${elapsed(summary.elapsedMs)}.`,
        summary.failed > 0 ? 'warn' : 'ok',
      );
    }
  } catch (error) {
    log(shortError(error), 'error');
    $('phase').textContent = 'Falhou. Veja o retorno abaixo.';
  } finally {
    clearInterval(app.ticker);
    $('cTime').textContent = elapsed(Date.now() - app.startedAt);
    setBusy(false);
    await refresh();
  }
}

async function applyDeletions() {
  try {
    const items = await api.deletions();
    if (items.length === 0) {
      log('Nenhuma exclusão pendente no servidor.', 'warn');
      return;
    }
    const confirmed = window.confirm(
      `Mover ${items.length} pasta(s) do histórico para a lixeira local?\n\nAs imagens já foram excluídas no site; esta ação remove os arquivos do PC.`,
    );
    if (!confirmed) return;

    setBusy(true);
    const result = await api.applyDeletions(items.map((item) => item.id));
    log(
      `${num.format(result.moved)} pasta(s) movida(s) para a lixeira, ${num.format(result.failed)} falha(s).`,
      result.failed > 0 ? 'warn' : 'ok',
    );
  } catch (error) {
    log(shortError(error), 'error');
  } finally {
    setBusy(false);
    await refresh();
  }
}

// ---------------------------------------------------------- configuracao

function readForm() {
  return {
    baseUrl: $('fBase').value.trim(),
    token: $('fToken').value.trim(),
    historyDir: $('fHistory').value.trim(),
    trashDir: $('fTrash').value.trim(),
    concurrency: Math.min(6, Math.max(1, Math.round(Number($('fConcurrency').value) || 2))),
  };
}

function fillForm(config) {
  $('fBase').value = config.baseUrl || '';
  $('fToken').value = config.token || '';
  $('fHistory').value = config.historyDir || '';
  $('fTrash').value = config.trashDir || '';
  $('fConcurrency').value = config.concurrency || 2;
}

async function loadSettings() {
  app.config = await api.loadConfig();
  fillForm(app.config);
  renderStats(null);
}

async function saveSettings() {
  try {
    app.config = await api.saveConfig(readForm());
    fillForm(app.config);
    hint('Configuração salva.', 'ok');
    log('Configuração salva.');
    await refresh();
  } catch (error) {
    hint(shortError(error), 'bad');
  }
}

async function testConnection() {
  const form = readForm();
  hint('Testando…');
  try {
    const info = await api.ping(form.baseUrl, form.token);
    hint(`Conectado · versão ${info.version} · ${num.format(info.images)} imagens`, 'ok');
  } catch (error) {
    hint(shortError(error), 'bad');
  }
}

// ------------------------------------------------------------------- start

function bindEvents() {
  $('refresh').addEventListener('click', () => void refresh());
  $('sync').addEventListener('click', () => void startSync(false));
  $('dry').addEventListener('click', () => void startSync(true));
  $('cancel').addEventListener('click', () => void api.cancel());
  $('deletes').addEventListener('click', () => void applyDeletions());
  $('save').addEventListener('click', () => void saveSettings());
  $('test').addEventListener('click', () => void testConnection());
  $('clear').addEventListener('click', () => {
    $('log').textContent = '';
  });

  $('bHistory').addEventListener('click', async () => {
    const chosen = await api.pickDir($('fHistory').value.trim());
    if (chosen) $('fHistory').value = chosen;
  });

  $('bTrash').addEventListener('click', async () => {
    const chosen = await api.pickDir($('fTrash').value.trim());
    if (chosen) $('fTrash').value = chosen;
  });
}

async function init() {
  bindEvents();

  api.onProgress(renderProgress);
  api.onLog(({ message, level }) => log(message, level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info'));

  try {
    const info = await api.info();
    for (const line of [...info.logs].reverse()) log(line);
    log(`Painel v${info.version} · ${num.format(info.stateCount)} imagem(ns) no estado local.`);
  } catch (error) {
    log(shortError(error), 'error');
  }

  try {
    await loadSettings();
  } catch (error) {
    log(shortError(error), 'error');
  }

  await refresh();
}

void init();

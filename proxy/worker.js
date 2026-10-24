// Cloudflare Worker do Ponto Rápido.
//
//   POST /hoje   { codigo, pin }  →  { data: "23/10/2026", periodos: [{ entrada: "08:29", saida: "12:56" }, ...] }
//     Faz login no portal web do Tangerino (código do empregador + PIN), abre a página
//     de apropriação de horas do mês e devolve só as marcações do dia. Não guarda nada.
//     Adicione ?debug=1 para ver em qual etapa falhou.
//
//   /<fingerprintWS|autorizaDipositivoWS|pontoWS>/...   proxy simples para a API de ponto
//     (plano B, caso o Tangerino deixe de liberar CORS).
//
// Deploy: Cloudflare → Workers & Pages → Create → Create Worker → cole este arquivo → Deploy.

const ALLOWED_ORIGINS = ['https://kaiomm.github.io'];   // ajuste se hospedar o app em outro domínio
const BASE = 'https://app.tangerino.com.br/Tangerino/';
const WS = BASE + 'ws/';
const ALLOWED_PATH = /^(fingerprintWS|autorizaDipositivoWS|pontoWS)\//;
const PASS_HEADERS = ['content-type', 'empregador', 'funcionarioid', 'username', 'authorization', 'pin'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

const cors = origin => ({
  'access-control-allow-origin': origin,
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': PASS_HEADERS.join(', '),
  'access-control-max-age': '86400',
  'vary': 'origin',
});

const json = (obj, status, origin) => new Response(JSON.stringify(obj), {
  status, headers: { ...cors(origin), 'content-type': 'application/json', 'cache-control': 'no-store' },
});

export default {
  async fetch(request) {
    const origin = request.headers.get('origin') || '';
    if (!ALLOWED_ORIGINS.includes(origin)) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, '');

    if (path === 'hoje' && request.method === 'POST') {
      const debug = url.searchParams.has('debug');
      const log = [];
      try {
        const { codigo, pin } = await request.json();
        if (!codigo || !pin) return json({ erro: 'codigo e pin são obrigatórios' }, 400, origin);
        const html = await loginAndFetchMonth(String(codigo), String(pin), log);
        const result = parseDay(html, todayBR());
        return json(debug ? { ...result, log } : result, 200, origin);
      } catch (e) {
        return json({ erro: e.message, ...(debug ? { log } : {}) }, 502, origin);
      }
    }

    if (!ALLOWED_PATH.test(path)) return new Response('Not found', { status: 404, headers: cors(origin) });
    return proxyWS(request, path, url.search, origin);
  },
};

// ---------- proxy da API de ponto (plano B) ----------
async function proxyWS(request, path, search, origin) {
  const headers = new Headers({
    'origin': 'https://app.tangerino.com.br',
    'referer': BASE + '?wicket:interface=:0:body:loginForm:baterPonto::ILinkListener::',
    'x-requested-with': 'XMLHttpRequest',
    'accept': 'application/json, text/plain, */*',
  });
  for (const h of PASS_HEADERS) { const v = request.headers.get(h); if (v) headers.set(h, v); }
  const upstream = await fetch(WS + path + search, {
    method: request.method, headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { ...cors(origin), 'content-type': upstream.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' },
  });
}

// ---------- login no portal (Wicket) + página do mês ----------
class Session {
  constructor(log) { this.jar = new Map(); this.log = log; }
  cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const c of list) {
      const [pair] = c.split(';'); const i = pair.indexOf('=');
      if (i > 0) this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  // Segue redirecionamentos manualmente para não perder cookies.
  async go(url, init = {}, step = '') {
    for (let hop = 0; hop < 6; hop++) {
      const res = await fetch(url, {
        ...init, redirect: 'manual',
        headers: { 'user-agent': UA, 'accept-language': 'pt-BR,pt;q=0.9', ...(init.headers || {}), cookie: this.cookieHeader() },
      });
      this.store(res);
      const loc = res.headers.get('location');
      this.log.push(`${step} ${init.method || 'GET'} ${new URL(url).pathname}${new URL(url).search.slice(0, 60)} → ${res.status}`);
      if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url).href; init = { headers: init.headers }; continue; }
      return { res, url, text: await res.text() };
    }
    throw new Error(`muitos redirecionamentos em ${step}`);
  }
}

const unescapeAttr = s => s.replace(/&amp;/g, '&');
const find = (html, re) => { const m = html.match(re); return m ? unescapeAttr(m[1] || m[0]) : null; };

async function loginAndFetchMonth(codigo, pin, log) {
  const s = new Session(log);

  // 1. Página inicial (cria a sessão) e o link "login funcionário", que troca o formulário
  //    padrão (e-mail/senha) pelo de código do empregador + PIN.
  let page = await s.go(BASE, {}, '1');
  const link = find(page.text, /['"]([^'"]*loginForm:loginFuncionario::ILinkListener[^'"]*)['"]/);
  if (link) page = await s.go(new URL(link, page.url).href, { headers: { referer: page.url } }, '2');
  else log.push('2 link "login funcionário" não encontrado; usando o formulário da página');
  const ajaxUrl = find(page.text, /['"]([^'"]*loginForm:btnLogin::IActivePageBehaviorListener[^'"]*)['"]/);
  if (!ajaxUrl) throw new Error('formulário de login não encontrado');
  const hidden = find(page.text, /name="(id\w+_hf_0)"/);
  const fieldNames = [...new Set([...page.text.matchAll(/<input[^>]*name="([^"]+)"/g)].map(m => m[1]))];
  log.push('campos do formulário: ' + fieldNames.join(', '));
  if (!fieldNames.includes('pin')) log.push('aviso: formulário sem campo "pin"');

  // 2. Envia código + PIN pelo botão AJAX do Wicket.
  const form = new URLSearchParams();
  if (hidden) form.set(hidden, '');
  form.set('latitude', ''); form.set('longitude', '');
  form.set('codigoEmpregador', codigo); form.set('pin', pin);
  form.set('g-recaptcha-response', ''); form.set('btnLogin', '1');
  const postUrl = new URL(ajaxUrl + (ajaxUrl.includes('random=') ? '' : `&random=${Math.random()}`), page.url).href;
  const login = await s.go(postUrl, {
    method: 'POST', body: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded', 'accept': 'text/xml',
      'wicket-ajax': 'true', 'origin': 'https://app.tangerino.com.br', 'referer': page.url,
    },
  }, '3');
  const redirect = find(login.text, /<redirect><!\[CDATA\[([^\]]*)\]\]><\/redirect>/);
  if (!redirect) {
    const reply = login.text.replace(new RegExp(pin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***')
      .replace(/<script[\s\S]*?<\/script>/g, '').replace(/\s+/g, ' ').slice(0, 600);
    log.push('resposta do login: ' + reply);
    throw new Error('login recusado (código do empregador ou PIN inválido?)');
  }
  await s.go(new URL(redirect, login.url).href, { headers: { referer: page.url } }, '4');

  // 3. Página de apropriação de horas (mês corrente por padrão).
  const month = await s.go(BASE + 'pages/apropriacao-horas', {}, '5');
  if (!/folhaponto-listpontos|:entrada"/.test(month.text)) throw new Error('página de marcações não carregou (sessão não autenticada?)');
  return month.text;
}

// ---------- leitura da tabela ----------
function todayBR() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year}`;
}

// Cada dia tem uma linha de cabeçalho com "dd/mm/aaaa - Dia" seguida de uma linha por período,
// com inputs "...:entrada" e "...:saida".
function parseDay(html, day) {
  const inputVal = (row, field) => {
    const tag = row.match(new RegExp(`<input[^>]*name="[^"]*:${field}"[^>]*>`));
    if (!tag) return undefined;
    const v = tag[0].match(/value="([^"]*)"/);
    return v ? v[1] : '';
  };
  const periodos = [];
  let current = null;
  for (const [, row] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const d = row.match(/<span>\s*(\d{2}\/\d{2}\/\d{4})\s*-[^<]*<\/span>/);
    if (d) current = d[1];
    const entrada = inputVal(row, 'entrada');
    if (entrada === undefined || current !== day) continue;
    periodos.push({ entrada, saida: inputVal(row, 'saida') || '' });
  }
  return { data: day, periodos };
}

export { parseDay };   // usado nos testes locais

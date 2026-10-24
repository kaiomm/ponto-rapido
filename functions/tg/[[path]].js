// Cloudflare Pages Function: proxy same-origin para a API web do Tangerino.
// O navegador chama /tg/<caminho> e esta função repassa para
// https://app.tangerino.com.br/Tangerino/ws/<caminho>, evitando o bloqueio de CORS.

const UPSTREAM = 'https://app.tangerino.com.br/Tangerino/ws/';
const ALLOWED = /^(fingerprintWS|autorizaDipositivoWS|pontoWS)\//;
const PASS_HEADERS = ['content-type', 'empregador', 'funcionarioid', 'username', 'authorization', 'pin'];

export async function onRequest({ request, params }) {
  const path = [].concat(params.path || []).join('/');
  if (!ALLOWED.test(path)) return new Response('Not found', { status: 404 });

  const search = new URL(request.url).search;
  const headers = new Headers({
    'origin': 'https://app.tangerino.com.br',
    'referer': 'https://app.tangerino.com.br/Tangerino/?wicket:interface=:0:body:loginForm:baterPonto::ILinkListener::',
    'x-requested-with': 'XMLHttpRequest',
    'accept': 'application/json, text/plain, */*',
  });
  for (const h of PASS_HEADERS) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }

  const upstream = await fetch(UPSTREAM + path + search, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    },
  });
}

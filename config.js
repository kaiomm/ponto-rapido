// Endereço da API de ponto. O Tangerino responde com Access-Control-Allow-Origin: *, então o app chama direto.
// Se um dia isso mudar, troque pela URL do Worker (proxy/worker.js), que também repassa essas chamadas.
window.PONTO_API = 'https://app.tangerino.com.br/Tangerino/ws';

// URL do Cloudflare Worker (proxy/worker.js) usado para mostrar as marcações de hoje.
// Vazio = recurso desligado. Ex.: 'https://ponto-proxy.seu-nome.workers.dev'
window.PONTO_TURNOS = 'https://ponto-proxy.kaiomm.workers.dev';

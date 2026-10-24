# Ponto Rápido — PWA para Sólides Tangerino

- **1º acesso:** pede *Código do Empregador* e *PIN*, confere, salva e segue o fluxo normal (contagem de 5 s).
- **Próximos acessos:** contagem de 5 s; se você não tocar/teclar/rolar a tela, registra sozinho.
  Qualquer interação (ou mandar o app para segundo plano) cancela.
- No celular, se o app ficou em segundo plano por mais de 30 s, ao reabrir pelo ícone a contagem recomeça.
- Proteção: o servidor recusa batidas com menos de 1 min de intervalo, então nesse período o registro automático não dispara e o botão fica travado com uma barra de progresso até liberar.
- Chave **"Registro automático ao abrir"** liga/desliga a contagem de 5 s (ligada por padrão). Desligada, o app só registra pelo botão.
- "Alterar credenciais" volta para o formulário.
- Opcional: abaixo de "Última batida" mostra as marcações de hoje (um período por linha, ex.: `08:29 – 12:56`, `14:08 – …`), lidas do portal do Tangerino por um Cloudflare Worker (veja abaixo).
  Ao lado de "Hoje:" aparece o total do dia: em laranja quando todos os períodos estão fechados; em cinza (como "Hoje:"), com um ponto verde pulsando,
  quando há período aberto (conta até agora e atualiza a cada 30 s).

## Como as chamadas são feitas
O Tangerino responde com `Access-Control-Allow-Origin: *`, então a página chama a API direto do navegador
(endereço em `config.js`). Não precisa de servidor.

## Marcações de hoje (opcional, precisa de um Worker)
As marcações do dia só existem na página de apropriação de horas do portal, que exige login com sessão
(cookie) e não libera CORS. O `proxy/worker.js` faz isso do lado do servidor: recebe código + PIN, faz login,
abre a página do mês, devolve só os períodos de hoje e não guarda nada.

1. dash.cloudflare.com → Workers & Pages → Create → Create Worker → Deploy.
2. Edit code → cole `proxy/worker.js` → Deploy.
3. Coloque a URL do Worker em `config.js`: `window.PONTO_TURNOS = 'https://ponto-proxy.<seu-nome>.workers.dev';`

Se o Worker falhar (fora do ar, erro ou mais de 30 s sem resposta), o app continua batendo ponto normalmente e mostra
"Não foi possível resgatar histórico de ponto do dia". Se ainda não há marcação hoje, mostra "Hoje: nenhuma marcação".
Enquanto a primeira carga não termina, mostra "Carregando histórico de hoje…".
Para diagnosticar, chame `POST <worker>/hoje?debug=1` com `{ "codigo": "...", "pin": "..." }`.

O mesmo Worker também repassa a API de ponto (plano B, caso o Tangerino deixe de liberar CORS):
basta trocar `PONTO_API` em `config.js` pela URL do Worker.

## Instalar no celular
Abra **https://kaiomm.github.io/ponto-rapido/** → Android: "Instalar app" · iPhone: Compartilhar → "Adicionar à Tela de Início".

### Alternativa: tudo no Cloudflare Pages
Hospedando a pasta inteira no Cloudflare Pages, `functions/tg` vira o proxy no mesmo domínio
e `config.js` pode ficar vazio.

## Avançado
- **Endereço da API:** padrão vem de `config.js` (direto no Tangerino). Para chamar direto: `https://app.tangerino.com.br/Tangerino/ws` (só funciona se o Tangerino liberar CORS).
- **Authorization:** gerado automaticamente como `Basic base64(<id do funcionário>:<código do empregador>)`,
  igual ao site oficial. Só preencha para forçar outro valor.

## Observações
- O PIN fica salvo em texto no `localStorage` do aparelho. Use só em dispositivo pessoal.
- Se sua empresa exige foto ou geolocalização no ponto web, o registro pode ser recusado — o app mostra a mensagem do servidor.
- Endpoints baseados no fluxo do ponto web do Tangerino (não oficial); podem mudar sem aviso.

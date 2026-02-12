# whatsapp-sender

Microserviço Node.js para envio de mensagens automáticas via **WhatsApp Web** usando **Baileys**.

> Ideal para ser chamado por outro backend via HTTP (por exemplo, após confirmação de compra).

## Stack mínima

- Node.js
- express
- @whiskeysockets/baileys
- pino

Sem TypeScript, sem banco de dados, sem Meta Cloud API, sem Twilio.

---

## 1) Rodando localmente

```bash
npm install
npm start
```

O serviço sobe em `http://localhost:10000` por padrão (ou porta definida em `PORT`).

---

## 2) Variáveis de ambiente

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `PORT` | Não | `10000` | Porta HTTP do serviço |
| `WA_SENDER_TOKEN` | Sim (para `/send`) | vazio | Token Bearer para proteger envio |
| `AUTH_DIR` | Não | `./auth` | Pasta de persistência da sessão WhatsApp |
| `MIN_SECONDS_BETWEEN_SAME_NUMBER` | Não | `60` | Janela mínima entre envios para o mesmo número |

### Exemplo (.env local)

```env
PORT=10000
WA_SENDER_TOKEN=seu_token_forte
AUTH_DIR=./auth
MIN_SECONDS_BETWEEN_SAME_NUMBER=60
```

> Se `WA_SENDER_TOKEN` estiver vazio, o serviço inicia normalmente, mas `/send` retorna erro `500` e `GET /` mostra `config_ok: false`.

---

## 3) Endpoints

### `GET /`

Retorna estado básico do serviço:

```json
{
  "ok": true,
  "connected": false,
  "has_qr": true,
  "config_ok": true
}
```

### `GET /qr`

Retorna QR atual:

- Quando houver QR:

```json
{ "ok": true, "qr": "..." }
```

- Quando não houver QR:

```json
{ "ok": false, "error": "Sem QR no momento" }
```

(com status HTTP `404`)

### `POST /send`

Header obrigatório:

```http
Authorization: Bearer SEU_TOKEN
```

Body:

```json
{
  "phone": "5511940431906",
  "message": "texto",
  "order_id": "opcional"
}
```

Regras:

- `phone`: formato E.164 sem `+` (apenas dígitos), entre 10 e 15 dígitos.
- `message`: não pode ser vazia.
- Rate limit por número com base em `MIN_SECONDS_BETWEEN_SAME_NUMBER`.
- Se WhatsApp não conectado: `503`.
- Sem token (ou token inválido): `401`.

Sucesso (`200`):

```json
{
  "ok": true,
  "order_id": "teste-001",
  "message_id": "ABGGFlA5..."
}
```

---

## 4) Como escanear QR

1. Inicie o serviço.
2. Acesse `GET /qr` (navegador ou curl) para obter o QR em texto.
3. No WhatsApp do celular: **Aparelhos conectados** > **Conectar um aparelho**.
4. Escaneie o QR.

Quando conectar, `GET /` passa a retornar `connected: true`.

---

## 5) Deploy no Render

### Configuração do serviço

- **Build Command**: `npm install`
- **Start Command**: `node server.js` (ou `npm start`)

Configure as ENV vars no painel do Render:

- `WA_SENDER_TOKEN`
- `AUTH_DIR`
- `MIN_SECONDS_BETWEEN_SAME_NUMBER`

`PORT` é injetada automaticamente pelo Render.

### Disk persistente (IMPORTANTE)

Para não perder sessão do WhatsApp a cada restart/deploy:

1. No Render, adicione um **Persistent Disk** ao serviço.
2. Monte em: `/var/data`
3. Defina a ENV:

```env
AUTH_DIR=/var/data/auth
```

Sem disk persistente, a sessão será perdida ao reiniciar e será necessário escanear o QR novamente.

---

## 6) Teste de envio com curl

```bash
curl -X POST https://SEU-SERVICO.onrender.com/send \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone":"5511940431906","message":"Teste ✅","order_id":"teste-001"}'
```

---

## Observações de segurança

- Nunca exponha seu `WA_SENDER_TOKEN` em logs.
- O endpoint `/send` sempre exige Bearer token.
- O serviço loga apenas eventos úteis (QR gerado, conexão, desconexão e erros).

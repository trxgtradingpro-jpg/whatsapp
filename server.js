const express = require('express');
const pino = require('pino');
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
} = require('@whiskeysockets/baileys');

const PORT = Number(process.env.PORT) || 10000;
const WA_SENDER_TOKEN = process.env.WA_SENDER_TOKEN || '';
const AUTH_DIR = process.env.AUTH_DIR || './auth';
const MIN_SECONDS_BETWEEN_SAME_NUMBER = Number(
  process.env.MIN_SECONDS_BETWEEN_SAME_NUMBER || '60'
);

const app = express();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

app.use(express.json({ limit: '1mb' }));

let sock = null;
let connected = false;
let lastQR = null;
let isConnecting = false;

const lastSentByPhone = new Map();

function isValidPhone(phone) {
  return /^\d{10,15}$/.test(phone);
}

function normalizeBearerToken(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token.trim();
}

async function connectWhatsApp() {
  if (isConnecting) return;
  isConnecting = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        lastQR = qr;
        connected = false;
        logger.info('Novo QR gerado.');
      }

      if (connection === 'open') {
        connected = true;
        lastQR = null;
        logger.info('WhatsApp conectado com sucesso.');
      }

      if (connection === 'close') {
        connected = false;

        const statusCode =
          lastDisconnect?.error?.output?.statusCode ||
          lastDisconnect?.error?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

        logger.warn(
          { statusCode, isLoggedOut },
          'Conexão do WhatsApp encerrada.'
        );

        if (!isLoggedOut) {
          setTimeout(() => {
            connectWhatsApp().catch((err) => {
              logger.error({ err: err.message }, 'Erro ao reconectar WhatsApp.');
            });
          }, 2000);
        } else {
          logger.warn('Sessão deslogada. Escaneie um novo QR para reconectar.');
        }
      }
    });

    sock.ev.on('connection.error', (err) => {
      logger.error({ err: err?.message || String(err) }, 'Erro de conexão WhatsApp.');
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Falha ao iniciar conexão com WhatsApp.');
  } finally {
    isConnecting = false;
  }
}

app.get('/', (req, res) => {
  res.json({
    ok: true,
    connected,
    has_qr: Boolean(lastQR),
    config_ok: Boolean(WA_SENDER_TOKEN),
  });
});

app.get('/qr', (req, res) => {
  if (!lastQR) {
    return res.status(404).json({ ok: false, error: 'Sem QR no momento' });
  }

  return res.json({ ok: true, qr: lastQR });
});

app.post('/send', async (req, res) => {
  const token = normalizeBearerToken(req.headers.authorization);

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Não autorizado' });
  }

  if (!WA_SENDER_TOKEN) {
    return res.status(500).json({ ok: false, error: 'Configuração incompleta: WA_SENDER_TOKEN ausente' });
  }

  if (token !== WA_SENDER_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Não autorizado' });
  }

  const { phone, message, order_id = null } = req.body || {};

  if (!isValidPhone(phone || '')) {
    return res.status(400).json({
      ok: false,
      error: 'Telefone inválido. Use E.164 sem +, entre 10 e 15 dígitos.',
    });
  }

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ ok: false, error: 'Mensagem inválida ou vazia' });
  }

  const now = Date.now();
  const lastSentAt = lastSentByPhone.get(phone);
  const cooldownMs = Math.max(MIN_SECONDS_BETWEEN_SAME_NUMBER, 0) * 1000;

  if (lastSentAt && now - lastSentAt < cooldownMs) {
    const secondsLeft = Math.ceil((cooldownMs - (now - lastSentAt)) / 1000);
    return res.status(429).json({
      ok: false,
      error: `Rate limit ativo para este número. Tente novamente em ${secondsLeft}s.`,
    });
  }

  if (!connected || !sock) {
    return res.status(503).json({ ok: false, error: 'WhatsApp não conectado' });
  }

  try {
    const jid = `${phone}@s.whatsapp.net`;
    const sent = await sock.sendMessage(jid, { text: message.trim() });

    lastSentByPhone.set(phone, now);

    return res.status(200).json({
      ok: true,
      order_id,
      message_id: sent?.key?.id || null,
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Erro ao enviar mensagem WhatsApp.');
    return res.status(500).json({ ok: false, error: 'Falha ao enviar mensagem' });
  }
});

app.listen(PORT, async () => {
  logger.info({ port: PORT, authDir: AUTH_DIR }, 'whatsapp-sender iniciado.');
  await connectWhatsApp();
});

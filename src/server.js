import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { ConversationStore } from "./conversations.js";
import { createGeminiClient } from "./gemini.js";
import { ConcurrencyLimiter } from "./limiter.js";
import { createWhatsAppClient, extractMessages } from "./whatsapp.js";

const MAX_WEBHOOK_BYTES = 1_000_000;

export function createRequestHandler({
  config,
  gemini,
  whatsapp,
  conversations = new ConversationStore({
    maxHistoryMessages: config.maxHistoryMessages,
    ttlMinutes: config.conversationTtlMinutes
  }),
  limiter = new ConcurrencyLimiter(config.maxConcurrentGeminiRequests),
  logger = console
}) {
  const processedMessageIds = new Map();
  const inFlightMessageIds = new Map();

  async function processWithRetries(operation, messageId) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === 3) {
          throw error;
        }
        logger.error(`Attempt ${attempt} failed for WhatsApp message ${messageId}; retrying:`, error);
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }

  function handleMessage(message) {
    if (processedMessageIds.has(message.id)) {
      return;
    }
    if (inFlightMessageIds.has(message.id)) {
      return inFlightMessageIds.get(message.id);
    }

    const task = conversations.enqueue(message.sender, () => processWithRetries(async () => {
      if (!message.text) {
        await whatsapp.sendText(
          message.sender,
          "¡Gracias por escribir a Perfect Polish! Aún no puedo revisar fotos o audios por aquí. ¿Me cuentas qué necesita tu vehículo?"
        );
        return;
      }

      const history = conversations.getHistory(message.sender);
      const reply = await limiter.run(() => gemini.reply(history, message.text));
      await whatsapp.sendText(message.sender, reply);
      conversations.addExchange(message.sender, message.text, reply);
    }, message.id));
    const trackedTask = task.then(() => {
      processedMessageIds.set(message.id, Date.now());
      if (processedMessageIds.size > 10_000) {
        const oldest = processedMessageIds.keys().next().value;
        processedMessageIds.delete(oldest);
      }
    }).finally(() => inFlightMessageIds.delete(message.id));
    inFlightMessageIds.set(message.id, trackedTask);
    return trackedTask;
  }

  return async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname === "/healthz" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ status: "ok" }));
      return;
    }

    const isWebhookPath = url.pathname === "/webhook" || url.pathname === "/" || url.pathname === "";
    if (!isWebhookPath) {
      response.writeHead(404).end("Not found");
      return;
    }

    if (request.method === "GET") {
      const isValid = url.searchParams.get("hub.mode") === "subscribe"
        && url.searchParams.get("hub.verify_token") === config.webhookVerifyToken
        && url.searchParams.has("hub.challenge");
      if (!isValid) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      response.writeHead(200, { "content-type": "text/plain" })
        .end(url.searchParams.get("hub.challenge"));
      return;
    }

    if (request.method !== "POST") {
      response.writeHead(405, { allow: "GET, POST" }).end("Method not allowed");
      return;
    }

    function handlePayload(rawBody) {
      if (config.metaAppSecret && config.metaAppSecret !== "sin_configurar") {
        const signature = request.headers["x-hub-signature-256"];
        const expectedSignature = `sha256=${createHmac("sha256", config.metaAppSecret)
          .update(rawBody)
          .digest("hex")}`;
        const signatureBuffer = Buffer.from(typeof signature === "string" ? signature : "");
        const expectedBuffer = Buffer.from(expectedSignature);
        if (
          signatureBuffer.length !== expectedBuffer.length
          || !timingSafeEqual(signatureBuffer, expectedBuffer)
        ) {
          response.writeHead(401).end("Invalid signature");
          return;
        }
      } else {
        logger.warn?.("META_APP_SECRET no configurado; omitiendo validación de firma temporalmente.");
      }

      let payload;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        response.writeHead(400).end("Invalid JSON");
        return;
      }

      response.writeHead(200).end("EVENT_RECEIVED");
      for (const message of extractMessages(payload)) {
        void handleMessage(message).catch((error) => {
          logger.error(`Failed to process WhatsApp message ${message.id}:`, error);
        });
      }
    }

    if (request.rawBody) {
      const rawBody = Buffer.isBuffer(request.rawBody)
        ? request.rawBody
        : Buffer.from(request.rawBody);
      if (rawBody.length > MAX_WEBHOOK_BYTES) {
        response.writeHead(413).end("Payload too large");
        return;
      }
      handlePayload(rawBody);
      return;
    }

    const chunks = [];
    let bodyLength = 0;
    let tooLarge = false;
    request.on("data", (chunk) => {
      bodyLength += chunk.length;
      if (bodyLength > MAX_WEBHOOK_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    request.on("end", () => {
      if (tooLarge) {
        response.writeHead(413).end("Payload too large");
        return;
      }
      handlePayload(Buffer.concat(chunks));
    });
  };
}

export function createAppServer(options) {
  const handler = createRequestHandler(options);
  return createHttpServer(handler);
}

function start() {
  const config = loadConfig();
  const server = createAppServer({
    config,
    gemini: createGeminiClient({
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
      business: config.business
    }),
    whatsapp: createWhatsAppClient({
      accessToken: config.whatsappAccessToken,
      phoneNumberId: config.whatsappPhoneNumberId,
      graphApiVersion: config.metaGraphApiVersion
    })
  });
  server.listen(config.port, config.host, () => {
    console.log(`Perfect Polish WhatsApp bot listening on ${config.host}:${config.port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start();
}

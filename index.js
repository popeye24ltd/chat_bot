import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { loadConfig } from "./src/config.js";
import { createGeminiClient } from "./src/gemini.js";
import { createWhatsAppClient } from "./src/whatsapp.js";
import { createRequestHandler } from "./src/server.js";

setGlobalOptions({
  region: "us-central1",
  maxInstances: 10
});

let handlerInstance = null;

function getHandler() {
  if (!handlerInstance) {
    const config = loadConfig();
    handlerInstance = createRequestHandler({
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
  }
  return handlerInstance;
}

export const webhook = onRequest({ cors: false }, async (req, res) => {
  const handler = getHandler();
  await handler(req, res);
});

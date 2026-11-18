const requiredVariables = [
  "META_APP_SECRET",
  "WEBHOOK_VERIFY_TOKEN",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "GEMINI_API_KEY"
];

export function loadConfig(env = process.env) {
  const missing = requiredVariables.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    console.warn(`[AVISO] Variables de entorno no configuradas aún: ${missing.join(", ")}. El servidor iniciará en modo espera.`);
  }

  const positiveInteger = (name, fallback) => {
    const value = Number.parseInt(env[name] ?? String(fallback), 10);
    if (!Number.isInteger(value) || value < 1) {
      return fallback;
    }
    return value;
  };

  return {
    port: positiveInteger("PORT", 8080),
    host: env.HOST || "0.0.0.0",
    metaAppSecret: env.META_APP_SECRET || "sin_configurar",
    webhookVerifyToken: env.WEBHOOK_VERIFY_TOKEN || "sin_configurar",
    whatsappAccessToken: env.WHATSAPP_ACCESS_TOKEN || "sin_configurar",
    whatsappPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || "sin_configurar",
    metaGraphApiVersion: env.META_GRAPH_API_VERSION || "v23.0",
    geminiApiKey: env.GEMINI_API_KEY || "sin_configurar",
    geminiModel: env.GEMINI_MODEL || "gemini-2.5-flash",
    maxConcurrentGeminiRequests: positiveInteger("MAX_CONCURRENT_GEMINI_REQUESTS", 10),
    maxHistoryMessages: positiveInteger("MAX_HISTORY_MESSAGES", 12),
    conversationTtlMinutes: positiveInteger("CONVERSATION_TTL_MINUTES", 1440),
    business: {
      name: env.BUSINESS_NAME || "Perfect Polish",
      services: env.BUSINESS_SERVICES || "Pulido y detallado automotriz",
      location: env.BUSINESS_LOCATION || "No especificada",
      hours: env.BUSINESS_HOURS || "No especificado",
      contact: env.BUSINESS_CONTACT || "No especificado",
      tone: env.BUSINESS_TONE || "Amable, profesional y natural"
    }
  };
}

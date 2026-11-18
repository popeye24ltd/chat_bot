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
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const positiveInteger = (name, fallback) => {
    const value = Number.parseInt(env[name] ?? String(fallback), 10);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive integer`);
    }
    return value;
  };

  return {
    port: positiveInteger("PORT", 8080),
    host: env.HOST || "0.0.0.0",
    metaAppSecret: env.META_APP_SECRET,
    webhookVerifyToken: env.WEBHOOK_VERIFY_TOKEN,
    whatsappAccessToken: env.WHATSAPP_ACCESS_TOKEN,
    whatsappPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    metaGraphApiVersion: env.META_GRAPH_API_VERSION || "v23.0",
    geminiApiKey: env.GEMINI_API_KEY,
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

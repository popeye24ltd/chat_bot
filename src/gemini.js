export function createGeminiClient({
  apiKey,
  geminiApiKey,
  model,
  geminiModel,
  business,
  fetchImpl = fetch
}) {
  const actualApiKey = apiKey || geminiApiKey;
  const actualModel = model || geminiModel;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(actualModel)}:generateContent`;
  const systemInstruction = [
    `Eres el asistente de atención al cliente de ${business?.name || "Perfect Polish"}, una agencia de pulido y cuidado automotriz.`,
    `Servicios: ${business?.services || "Pulido y detallado automotriz"}.`,
    `Zona: ${business?.location || "No especificada"}. Horario: ${business?.hours || "No especificado"}. Contacto: ${business?.contact || "No especificado"}.`,
    `Estilo: ${business?.tone || "Amable, profesional y natural"}. Responde en el idioma del cliente, de forma cálida, breve y conversacional.`,
    "Ayuda a entender qué servicio necesita, resuelve dudas y facilita reservar o pedir una cotización.",
    "No inventes precios, disponibilidad, resultados garantizados ni datos del negocio. Si falta información, dilo con naturalidad y pregunta solo lo necesario.",
    "No afirmes ser una persona. Si te preguntan, explica con sencillez que eres el asistente virtual de Perfect Polish."
  ].join("\n");

  return {
    async reply(history, userMessage) {
      const response = await fetchImpl(`${endpoint}?key=${encodeURIComponent(actualApiKey)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [...history, { role: "user", parts: [{ text: userMessage }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 400 }
        })
      });

      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = result?.error?.message || response.statusText;
        throw new Error(`Gemini request failed (${response.status}): ${detail}`);
      }

      const text = result?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text)
        .filter(Boolean)
        .join("")
        .trim();
      if (!text) {
        throw new Error("Gemini returned no response text");
      }
      return text;
    }
  };
}

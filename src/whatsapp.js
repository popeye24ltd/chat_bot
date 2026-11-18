export function extractMessages(payload) {
  const messages = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const message of change?.value?.messages ?? []) {
        if (typeof message.from !== "string" || typeof message.id !== "string") {
          continue;
        }
        const text = typeof message.text?.body === "string"
          ? message.text.body.trim()
          : null;
        messages.push({
          id: message.id,
          sender: message.from,
          text: text || (text === "" ? "" : null)
        });
      }
    }
  }
  return messages;
}

export function createWhatsAppClient({
  accessToken,
  whatsappAccessToken,
  phoneNumberId,
  whatsappPhoneNumberId,
  graphApiVersion,
  metaGraphApiVersion,
  fetchImpl = fetch
}) {
  const actualToken = accessToken || whatsappAccessToken;
  const actualPhoneId = phoneNumberId || whatsappPhoneNumberId;
  const actualVersion = graphApiVersion || metaGraphApiVersion || "v23.0";
  const endpoint = `https://graph.facebook.com/${actualVersion}/${encodeURIComponent(actualPhoneId)}/messages`;

  return {
    async sendText(to, body) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${actualToken}`,
          "content-type": "application/json"
        },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body }
        })
      });

      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = result?.error?.message || response.statusText;
        throw new Error(`WhatsApp send failed (${response.status}): ${detail}`);
      }
    }
  };
}

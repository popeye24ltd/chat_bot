import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { ConversationStore } from "../src/conversations.js";
import { ConcurrencyLimiter } from "../src/limiter.js";
import { createAppServer } from "../src/server.js";
import { extractMessages, createWhatsAppClient } from "../src/whatsapp.js";
import { createGeminiClient } from "../src/gemini.js";

const config = {
  metaAppSecret: "app-secret",
  webhookVerifyToken: "verify-me",
  maxHistoryMessages: 8,
  conversationTtlMinutes: 60,
  maxConcurrentGeminiRequests: 2
};

test("serializes messages for one customer while allowing different customers in parallel", async () => {
  const conversations = new ConversationStore({ maxHistoryMessages: 8, ttlMinutes: 60 });
  const order = [];
  let releaseFirst;
  const first = conversations.enqueue("customer-a", async () => {
    order.push("first-start");
    await new Promise((resolve) => { releaseFirst = resolve; });
    order.push("first-end");
  });
  const second = conversations.enqueue("customer-a", async () => order.push("second"));
  const other = conversations.enqueue("customer-b", async () => order.push("other"));

  await other;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["first-start", "other"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first-start", "other", "first-end", "second"]);
});

test("limits the number of active requests", async () => {
  const limiter = new ConcurrencyLimiter(2);
  let active = 0;
  let maximum = 0;
  await Promise.all(Array.from({ length: 8 }, () => limiter.run(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
  })));
  assert.equal(maximum, 2);
});

test("extracts text and media messages but ignores status events", () => {
  const messages = extractMessages({
    entry: [{ changes: [{ value: {
      messages: [
        { id: "text-1", from: "15550001", text: { body: " Hola " } },
        { id: "image-1", from: "15550002", image: { id: "image" } }
      ],
      statuses: [{ id: "sent-1" }]
    } }] }]
  });
  assert.deepEqual(messages, [
    { id: "text-1", sender: "15550001", text: "Hola" },
    { id: "image-1", sender: "15550002", text: null }
  ]);
});

test("verifies the Meta webhook and rejects an incorrect token", async (t) => {
  const server = createAppServer({
    config,
    gemini: { reply: async () => "Hola" },
    whatsapp: { sendText: async () => {} },
    logger: { error() {} }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}/webhook`;

  const valid = await fetch(`${base}?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`);
  assert.equal(valid.status, 200);
  assert.equal(await valid.text(), "12345");
  const invalid = await fetch(`${base}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345`);
  assert.equal(invalid.status, 403);
});

test("provides an HTTP health check for the VPS container", async (t) => {
  const server = createAppServer({
    config,
    gemini: { reply: async () => "Hola" },
    whatsapp: { sendText: async () => {} }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("acknowledges webhook immediately and keeps each sender's history separate", async (t) => {
  const replies = [];
  const sent = [];
  let resolveSent;
  const allSent = new Promise((resolve) => { resolveSent = resolve; });
  const server = createAppServer({
    config,
    gemini: {
      async reply(history, message) {
        replies.push({ history, message });
        return `Reply to ${message}`;
      }
    },
    whatsapp: {
      async sendText(to, text) {
        sent.push({ to, text });
        if (sent.length === 2) {
          resolveSent();
        }
      }
    },
    logger: { error(error) { throw error; } }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/webhook`;
  const payload = {
    entry: [{ changes: [{ value: { messages: [
      { id: "m1", from: "customer-a", text: { body: "Precio?" } },
      { id: "m2", from: "customer-b", text: { body: "Hola" } }
    ] } }] }]
  };
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", config.metaAppSecret).update(body).digest("hex");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": `sha256=${signature}`
    },
    body
  });
  assert.equal(response.status, 200);
  await allSent;
  assert.deepEqual(replies.map((reply) => reply.history.length), [0, 0]);
  assert.deepEqual(sent.length, 2);
});

test("rejects unsigned webhooks", async (t) => {
  const server = createAppServer({
    config,
    gemini: { reply: async () => "Hola" },
    whatsapp: { sendText: async () => {} }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/webhook`, {
    method: "POST",
    body: JSON.stringify({ entry: [] })
  });
  assert.equal(response.status, 401);
});

test("retries a transient Gemini failure before marking the message processed", async (t) => {
  let attempts = 0;
  const sent = [];
  let resolveSent;
  const allSent = new Promise((resolve) => { resolveSent = resolve; });
  const server = createAppServer({
    config,
    gemini: {
      async reply() {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("temporary provider error");
        }
        return "¡Claro!";
      }
    },
    whatsapp: {
      async sendText(to, text) {
        sent.push({ to, text });
        resolveSent();
      }
    },
    logger: { error() {} }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [
    { id: "retry-1", from: "customer-a", text: { body: "Hola" } }
  ] } }] }] });
  const signature = createHmac("sha256", config.metaAppSecret).update(body).digest("hex");
  const response = await fetch(`http://127.0.0.1:${server.address().port}/webhook`, {
    method: "POST",
    headers: { "x-hub-signature-256": `sha256=${signature}` },
    body
  });
  assert.equal(response.status, 200);
  await allSent;
  assert.equal(attempts, 2);
  assert.deepEqual(sent, [{ to: "customer-a", text: "¡Claro!" }]);
});

test("createGeminiClient supports both naming formats", async () => {
  let capturedUrl = "";
  const mockFetch = async (url) => {
    capturedUrl = url;
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Respuesta de prueba" }] } }]
      })
    };
  };

  const client1 = createGeminiClient({
    geminiApiKey: "key-123",
    geminiModel: "gemini-2.5-flash",
    business: { name: "Test" },
    fetchImpl: mockFetch
  });
  const res1 = await client1.reply([], "hola");
  assert.equal(res1, "Respuesta de prueba");
  assert.match(capturedUrl, /models\/gemini-2\.5-flash:generateContent\?key=key-123/);

  const client2 = createGeminiClient({
    apiKey: "key-456",
    model: "gemini-1.5-pro",
    business: { name: "Test" },
    fetchImpl: mockFetch
  });
  const res2 = await client2.reply([], "hola");
  assert.equal(res2, "Respuesta de prueba");
  assert.match(capturedUrl, /models\/gemini-1\.5-pro:generateContent\?key=key-456/);
});

test("createWhatsAppClient supports both naming formats", async () => {
  let capturedUrl = "";
  let capturedAuth = "";
  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedAuth = options.headers.authorization;
    return {
      ok: true,
      json: async () => ({ success: true })
    };
  };

  const client1 = createWhatsAppClient({
    whatsappAccessToken: "token-abc",
    whatsappPhoneNumberId: "phone-999",
    metaGraphApiVersion: "v23.0",
    fetchImpl: mockFetch
  });
  await client1.sendText("12345", "test message");
  assert.equal(capturedUrl, "https://graph.facebook.com/v23.0/phone-999/messages");
  assert.equal(capturedAuth, "Bearer token-abc");

  const client2 = createWhatsAppClient({
    accessToken: "token-xyz",
    phoneNumberId: "phone-888",
    graphApiVersion: "v22.0",
    fetchImpl: mockFetch
  });
  await client2.sendText("12345", "test message");
  assert.equal(capturedUrl, "https://graph.facebook.com/v22.0/phone-888/messages");
  assert.equal(capturedAuth, "Bearer token-xyz");
});

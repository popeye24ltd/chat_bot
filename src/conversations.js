export class ConversationStore {
  constructor({ maxHistoryMessages, ttlMinutes, now = Date.now }) {
    this.maxHistoryMessages = maxHistoryMessages;
    this.ttlMilliseconds = ttlMinutes * 60 * 1000;
    this.now = now;
    this.conversations = new Map();
    this.tails = new Map();
  }

  enqueue(sender, task) {
    const previous = this.tails.get(sender) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    this.tails.set(sender, current);
    const cleanup = () => {
      if (this.tails.get(sender) === current) {
        this.tails.delete(sender);
      }
    };
    current.then(cleanup, cleanup);
    return current;
  }

  getHistory(sender) {
    const conversation = this.conversations.get(sender);
    if (!conversation || this.now() - conversation.updatedAt > this.ttlMilliseconds) {
      this.conversations.delete(sender);
      return [];
    }
    return [...conversation.history];
  }

  addExchange(sender, userMessage, assistantMessage) {
    const history = [
      ...this.getHistory(sender),
      { role: "user", parts: [{ text: userMessage }] },
      { role: "model", parts: [{ text: assistantMessage }] }
    ].slice(-this.maxHistoryMessages);

    this.conversations.set(sender, { history, updatedAt: this.now() });
  }
}

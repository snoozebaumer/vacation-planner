const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b-instruct";
const CHAT_TIMEOUT_MS = Number(process.env.OLLAMA_CHAT_TIMEOUT_MS ?? 60000);

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  message: ChatMessage;
}

export async function ollamaChat(
  messages: ChatMessage[],
  timeoutMs: number = CHAT_TIMEOUT_MS,
  extraOptions: Record<string, unknown> = {}
): Promise<ChatResult> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      // No-op for plain instruct models; keeps hybrid-reasoning models
      // (Qwen3 and friends) from prepending a <think> block, in case this
      // is ever pointed at one again.
      think: false,
      options: { temperature: 0.1, ...extraOptions },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Ollama chat failed with status ${res.status}: ${await res.text()}`);
  }
  const data: any = await res.json();
  return { message: data.message };
}

export async function chatComplete({ apiKey, model, messages, tools, maxTokens, timeoutMs = 90000 }) {
  const body = {
    model,
    max_completion_tokens: maxTokens,
    messages,
  };
  if (tools && tools.length) body.tools = tools;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (response.status === 429) {
      const error = new Error("Превышен лимит запросов к ИИ-ассистенту. Пожалуйста, подождите");
      error.status = 429;
      throw error;
    }
    if (!response.ok) {
      const error = new Error("OpenAI unavailable");
      error.status = response.status >= 500 ? 502 : response.status;
      throw error;
    }
    const data = JSON.parse(raw);
    return data.choices?.[0]?.message || null;
  } finally {
    clearTimeout(timer);
  }
}

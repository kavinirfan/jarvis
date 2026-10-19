/**
 * Turns Gemini's server-sent-events stream into a stream of plain answer text.
 * Skips "thought" parts and chunks with no text, and never stalls on empty chunks.
 */
export function geminiSseToText(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = body.getReader();
  let buffer = "";

  const textFromLine = (line: string): string => {
    if (!line.startsWith("data:")) return "";
    try {
      const chunk = JSON.parse(line.slice(5)) as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
      };
      return (chunk.candidates?.[0]?.content?.parts ?? [])
        .filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("");
    } catch {
      return "";
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          const rest = textFromLine(buffer.trim());
          if (rest) controller.enqueue(encoder.encode(rest));
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        const t = lines.map((l) => textFromLine(l.trimEnd())).join("");
        if (t) {
          controller.enqueue(encoder.encode(t));
          return;
        }
      }
    },
    cancel() {
      void reader.cancel();
    },
  });
}

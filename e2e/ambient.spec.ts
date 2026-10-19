import { expect, test } from "@playwright/test";
import path from "node:path";

/**
 * Ambient mode: continuous streaming transcription (Gemini Live over WebSocket). The fake mic
 * plays chatter ("I think we should get pizza tonight.") then an overheard question that never
 * says "Jarvis". JARVIS should transcribe both, ignore the chatter, and answer the question.
 */
const EMAIL = process.env.E2E_EMAIL ?? "tester@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "correct horse battery";

test.use({
  headless: false, // see full-flow.spec.ts: headless Chrome on macOS never resolves getUserMedia
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${path.resolve("e2e/fixtures/ambient-overheard-question.wav")}%noloop`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

test("ambient: transcribes nearby speech, ignores chatter, answers an overheard question", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("enable-listening")).toBeVisible();
  const prev = await page.request.put("/api/settings", { data: { listenMode: "ambient", sttEngine: "gemini", language: "en-US" }, headers: { origin: new URL(page.url()).origin } });
  expect(prev.ok()).toBe(true);
  await page.reload();

  try {
    await page.getByTestId("enable-listening").click();
    await expect(page.getByText("ambient mode")).toBeVisible();
    // The live transcript shows both utterances (open the transcript panel on narrower layouts).
    const transcript = page.getByTestId("transcript").first();
    await expect(transcript).toContainText(/pizza/i, { timeout: 30_000 });
    await expect(transcript).toContainText(/moon/i, { timeout: 30_000 });
    const card = page.getByTestId("answer-card").last();
    await expect(card).toContainText(/Overheard/, { timeout: 30_000 });
    await expect(card).toContainText(/moon/i);
    await expect(card).toContainText(/(384|238)[,.\s]?\d{3}|kilomet|miles/i, { timeout: 60_000 });
    // Only the question produced an answer; the chatter was ignored.
    await expect(page.getByTestId("answer-card")).toHaveCount(1);
    await page.getByTestId("stop-listening").click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __jarvis: { captureLive: () => boolean } }).__jarvis.captureLive())).toBe(false);
  } finally {
    await page.request.put("/api/settings", { data: { listenMode: "wake" }, headers: { origin: new URL(page.url()).origin } });
  }
});

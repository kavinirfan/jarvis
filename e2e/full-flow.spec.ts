import { expect, request, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * The complete workflow against REAL services (Gemini + web search) with a fake microphone that
 * plays e2e/fixtures/hey-jarvis-question.wav ("Hey Jarvis... what is the capital of France?").
 *
 *   E2E_EMAIL / E2E_PASSWORD: an existing account on the server under test.
 */
const EMAIL = process.env.E2E_EMAIL ?? "tester@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "correct horse battery";
const FIXTURE = path.resolve("e2e/fixtures/hey-jarvis-question.wav");

// Headless Chrome on macOS never resolves getUserMedia (even with fake devices), so this spec runs
// a visible Chrome window.
test.use({
  headless: false,
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${FIXTURE}%noloop`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("enable-listening")).toBeVisible();
}

const jarvis = <T,>(page: Page, fn: string) => page.evaluate((f) => (window as unknown as { __jarvis: Record<string, () => unknown> }).__jarvis[f]() as T, fn);

test("voice: wake word → transcribe → answer → speak → interrupt → follow-up → memory → stop", async ({ page, browser }) => {
  const log: string[] = [];
  page.on("console", (m) => m.type() === "error" && log.push(m.text()));
  const t0 = Date.now();
  const mark = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

  // 1-2. Launch and sign in.
  await signIn(page);
  mark("signed in");

  // 3. Enable listening (wake mode). The fake mic starts playing when capture starts.
  await page.getByTestId("enable-listening").click();
  await expect(page.getByTestId("mic-live")).toBeVisible();
  await expect.poll(() => jarvis<boolean>(page, "captureLive")).toBe(true);
  await expect(page.getByText("on-device")).toBeVisible({ timeout: 30_000 });
  mark("listening, wake-word model ready");

  // 4-6. "Hey Jarvis" is detected on-device, the command is transcribed and understood.
  await expect(page.getByTestId("phase")).toHaveAttribute("data-phase", /capturing|transcribing|thinking|researching|speaking/, { timeout: 30_000 });
  mark("wake word detected");
  const card = page.getByTestId("answer-card").first();
  await expect(card).toContainText(/capital of France/i, { timeout: 60_000 });
  await expect(card).toContainText(/Voice/);
  // 7-8. Answer (direct or researched) mentions Paris.
  await expect(card).toContainText(/Paris/, { timeout: 60_000 });
  mark("answer received");

  // 9. JARVIS speaks the answer: wait until audio is actually playing, not just loading.
  await expect.poll(() => jarvis<string>(page, "playerState"), { timeout: 30_000 }).toBe("speaking");
  const playing = await page.evaluate(() => [...document.querySelectorAll("audio")].length >= 0 && (window as unknown as { __jarvis: { playerState: () => string } }).__jarvis.playerState());
  mark(`speaking (player state: ${playing})`);
  await page.waitForTimeout(1500); // let it speak for a moment

  // 10. Interrupt.
  await page.getByTestId("interrupt").click();
  await expect.poll(() => jarvis<string>(page, "playerState")).toBe("idle");
  mark("interrupted");

  // 11. Follow-up question that depends on context ("its").
  await page.getByTestId("ask-input").fill("And roughly how many people live there?");
  await page.getByTestId("ask-submit").click();
  const second = page.getByTestId("answer-card").nth(1);
  await expect(second).toContainText(/million/i, { timeout: 90_000 });
  mark("follow-up answered in context");
  await page.getByTestId("interrupt").click().catch(() => {});

  // 12. Save an approved memory.
  const code = `AURORA-${Date.now() % 100000}`;
  await page.getByTestId("ask-input").fill(`Remember that my test code word is ${code}`);
  await page.getByTestId("ask-submit").click();
  await expect(page.getByTestId("answer-card").nth(2)).toContainText(code, { timeout: 30_000 });
  mark("memory saved");

  // 13. Retrieve it from another, independently signed-in session.
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signIn(page2);
  await page2.getByRole("tab", { name: /Memory/ }).click();
  await expect(page2.getByTestId("memory-panel")).toContainText(code);
  mark("memory visible in second session");
  await other.close();

  // 14-15. Disable listening and verify capture really stopped.
  await page.getByTestId("stop-listening").click();
  await expect(page.getByTestId("mic-off")).toBeVisible();
  expect(await jarvis<boolean>(page, "captureLive")).toBe(false);
  expect(await jarvis<boolean>(page, "listening")).toBe(false);
  mark("listening disabled; all capture tracks ended");

  // A 429 here means Gemini's voice quota was hit and JARVIS fell back to the browser voice (handled).
  const quota = log.filter((l) => /status of 429/.test(l));
  if (quota.length) console.log(`note: ${quota.length} rate-limited request(s); natural voice fell back to browser voice`);
  const errors = log.filter((l) => !/favicon|DevTools|status of 429/.test(l));
  if (errors.length) console.log("console errors:", errors);
  expect(errors).toEqual([]);
});

test("research: real search with genuine, reachable citations", async ({ page }) => {
  await signIn(page);
  await page.getByTestId("ask-input").fill("When was the Eiffel Tower completed and how tall is it?");
  await page.getByRole("button", { name: "Research", exact: true }).click();
  const card = page.getByTestId("answer-card").last();
  await expect(card).toContainText(/1889/, { timeout: 120_000 });
  await page.getByRole("tab", { name: /Research/ }).click();
  const links = page.getByTestId("sources").locator("a[href^='http']");
  await expect(links.first()).toBeVisible();
  const hrefs = await links.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  expect(hrefs.length).toBeGreaterThan(0);
  expect(hrefs.every((h) => h.startsWith("https://") && !h.includes("example.com"))).toBe(true);
  // Citations in the answer link to those same sources.
  const cited = await card.locator("sup a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  expect(cited.length).toBeGreaterThan(0);
  expect(cited.every((h) => hrefs.includes(h))).toBe(true);
  // The cited pages really exist.
  const api = await request.newContext();
  for (const h of [...new Set(cited)].slice(0, 3)) {
    const r = await api.get(h, { headers: { "user-agent": "JARVIS-e2e" }, maxRedirects: 5 });
    expect(r.status(), h).toBeLessThan(400);
  }
  await api.dispose();
});

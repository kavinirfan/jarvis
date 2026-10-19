import { expect, test } from "@playwright/test";

/** The dashboard must work from small phones to wide desktops without horizontal scrolling. */
const EMAIL = process.env.E2E_EMAIL ?? "tester@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "correct horse battery";

const VIEWPORTS = [
  { name: "phone-small", width: 360, height: 740 },
  { name: "phone", width: 393, height: 852 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "laptop", width: 1366, height: 820 },
  { name: "desktop-wide", width: 1920, height: 1080 },
];

for (const vp of VIEWPORTS) {
  test(`layout @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByTestId("enable-listening")).toBeVisible();
    await expect(page.getByTestId("ask-input")).toBeVisible();
    await expect(page.getByTestId("mic-off")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // Every panel tab is reachable.
    for (const name of ["Research", "Memory", "Settings", "Status"]) {
      await page.getByRole("tab", { name: new RegExp(`^${name}`) }).first().click();
    }
    await page.screenshot({ path: `test-results/screens/${vp.name}.png`, fullPage: false });
  });
}

test("respects reduced motion and has accessible controls", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: /Enable Listening/ })).toBeVisible();
  const dur = await page.evaluate(() => getComputedStyle(document.querySelector(".animate-orb-spin")!).animationDuration);
  expect(parseFloat(dur)).toBeLessThan(0.01);
  await ctx.close();
});

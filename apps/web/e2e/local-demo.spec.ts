import { expect, test } from "@playwright/test";

import { FICTIONAL_PNG_BYTES } from "./fixtures.js";

test("runs the fake-backed reviewer and credential flow in a real browser", async ({ page }) => {
  const consoleErrors: string[] = [];
  const unexpectedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (!request.url().startsWith("http://localhost:3100") && !request.url().startsWith("ws://localhost:3100")) {
      unexpectedRequests.push(request.url());
    }
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("Fictional data only.")).toBeVisible();
  await page.getByRole("button", { name: "Enter local reviewer demo" }).click();

  const persona = page.getByLabel("Simulated participant for this tab");
  await expect(persona).toBeVisible();
  await persona.selectOption("member:owner");
  await expect(page.getByRole("heading", { name: "MedBuddy conversation" })).toBeVisible();
  const reviewerWorkspacePath = new URL(page.url()).pathname.split("/").at(-1)!;
  expect((await page.request.get(`/api/workspaces/${reviewerWorkspacePath}/messages?limit=10`, {
    headers: { "X-MedBuddy-Demo-Member": "member:unknown" },
  })).status()).toBe(403);
  expect((await page.request.get("/api/workspaces/workspace%3Acredential-test/messages?limit=10", {
    headers: { "X-MedBuddy-Demo-Member": "member:owner" },
  })).status()).toBe(403);

  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  await composer.fill("@MedBuddy I felt fictional mild dizziness after breakfast.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Thanks for sharing. I can help organize this fictional report")).toBeVisible();
  await expect(page.getByText("Captured:", { exact: false }).last()).toBeVisible({ timeout: 5_000 });

  await page.getByLabel("Attach a fictional medication-label image").setInputFiles({
    name: "fictional-label.png",
    mimeType: "image/png",
    buffer: FICTIONAL_PNG_BYTES,
  });
  await composer.fill("Fictional medication label upload.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Fictional medication label upload.")).toBeVisible();

  await composer.fill("[demo:fail-once] Fictional capture retry check.");
  await page.getByRole("button", { name: "Send message" }).click();
  const failedMessage = page.getByRole("article", { name: "Message from You" }).filter({
    hasText: "Fictional capture retry check.",
  });
  await expect(failedMessage.getByText("Failed:", { exact: false })).toBeVisible({ timeout: 5_000 });
  await failedMessage.getByRole("button", { name: "Retry capture" }).click();
  await expect(failedMessage.getByText("Captured:", { exact: false })).toBeVisible({ timeout: 5_000 });

  await page.getByRole("link", { name: "Review facts" }).click();
  await expect(page.getByRole("heading", { name: "Review captured facts" })).toBeVisible();
  await expect(page.getByText("Conflicts with fact:caregiver-timing")).toBeVisible();

  await page.getByRole("link", { name: "Handoff v1" }).click();
  await expect(page.getByRole("heading", { name: "Printable handoff v1" })).toBeVisible();
  await expect(page.getByText("mild dizziness")).toHaveCount(0);
  await page.evaluate(() => {
    window.print = () => { document.body.dataset.printInvoked = "true"; };
  });
  await page.getByRole("button", { name: "Print this handoff" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-print-invoked", "true");

  await page.getByRole("link", { name: "Version 2" }).click();
  await expect(page.getByRole("heading", { name: "Printable handoff v2" })).toBeVisible();
  await expect(page.getByText("mild dizziness")).toBeVisible();

  await page.getByRole("link", { name: "Back to review" }).click();
  await page.getByRole("link", { name: "Back to conversation" }).click();
  await expect(page.getByLabel("Simulated participant for this tab")).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Open the local MedBuddy demo" })).toBeVisible();
  expect((await page.request.get("/api/local-auth/session")).status()).toBe(401);
  await page.getByRole("button", { name: "Sign in with fictional credentials" }).click();
  await expect(page.getByText("Signed in as fixed fictional participant:")).toBeVisible();
  await expect(page.getByLabel("Simulated participant for this tab")).toHaveCount(0);
  expect((await page.request.get("/api/workspaces/workspace%3Acredential-test/messages?limit=10", {
    headers: { "X-MedBuddy-Demo-Member": "member:caregiver-a" },
  })).status()).toBe(200);

  expect(consoleErrors).toEqual([]);
  expect(unexpectedRequests).toEqual([]);
});

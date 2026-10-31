import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const org = "22222222-2222-4222-8222-222222222222";
const foreignOrg = "11111111-1111-4111-8111-111111111111";
const base = `/workspace/${org}/locations`;
const fixture = "http://127.0.0.1:54329";
async function signIn(page: Page, email = "other@profitplate.test") {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("ProfitPlate-test-2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\//);
}

test("owner creates, validates, edits, deactivates and reactivates a saved location", async ({
  page,
}) => {
  const org = "33333333-3333-4333-8333-333333333333";
  const base = `/workspace/${org}/locations`;
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: undefined,
    });
  });
  await signIn(page, "locations-owner@profitplate.test");
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "Locations", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your first location starts here." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Add your first location" }).click();
  await page
    .getByRole("textbox", { name: "Location name", exact: true })
    .fill("Main Kitchen");
  await page
    .getByRole("textbox", { name: "Location code", exact: true })
    .fill("main-kitchen");
  // Bypass HTML validation to exercise the server boundary as well.
  await page
    .getByRole("textbox", { name: "Location code", exact: true })
    .fill("invalid code");
  await page.locator("form.location-form").evaluate((form: HTMLFormElement) => {
    form.noValidate = true;
  });
  await page.getByRole("button", { name: "Add location", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Use a code of 1–32",
  );
  await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
  await expect(
    page.getByRole("textbox", { name: "Location name", exact: true }),
  ).toHaveValue("Main Kitchen");
  await page
    .getByRole("textbox", { name: "Location code", exact: true })
    .fill("main-kitchen");
  await page.getByRole("button", { name: "Add location", exact: true }).click();
  await expect(page).toHaveURL(`${base}?saved=created`);
  await expect(page.getByRole("status")).toContainText("Location added.");
  await expect(
    page.getByRole("article", { name: "Main Kitchen", exact: true }),
  ).toContainText("MAIN-KITCHEN");
  await page.reload();
  await expect(
    page.getByRole("article", { name: "Main Kitchen", exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Add location", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Location name", exact: true })
    .fill("Duplicate kitchen");
  await page
    .getByRole("textbox", { name: "Location code", exact: true })
    .fill("MAIN-KITCHEN");
  await page.getByRole("button", { name: "Add location", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "already in use",
  );
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);

  await page
    .getByRole("link", { name: "Edit Main Kitchen", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Location name", exact: true })
    .fill("Central Kitchen");
  await page
    .getByRole("textbox", { name: "Location code", exact: true })
    .fill("central");
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("inactive");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(`${base}?saved=updated`);
  await expect(
    page.getByRole("article", { name: "Central Kitchen", exact: true }),
  ).toContainText("Inactive");
  await page.goto(`/workspace/${org}`);
  await expect(
    page.getByText("0 active locations in this business.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Define your locations", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Edit Central Kitchen", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("active");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page
      .getByRole("article", { name: "Central Kitchen", exact: true })
      .getByText("Active", { exact: true }),
  ).toBeVisible();
  await page.goto(`/workspace/${org}`);
  await expect(
    page.getByText("1 active locations in this business.", { exact: true }),
  ).toBeVisible();
});

test("viewer can read locations but cannot open management forms", async ({
  page,
}) => {
  await signIn(page, "locations-viewer@profitplate.test");
  await page.goto(base);
  await expect(
    page.getByRole("article", { name: "Central Kitchen", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Ask a business owner or admin", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Add location", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Edit / })).toHaveCount(0);
  await page.goto(`${base}/new`);
  await expect(page).toHaveURL(base);
});

test("admin form rechecks live permissions and rejects a location from another business", async ({
  page,
  request,
}) => {
  await signIn(page, "locations-admin@profitplate.test");
  await page.goto(base);
  const editLink = page.getByRole("link", {
    name: "Edit Central Kitchen",
    exact: true,
  });
  const editPath = await editLink.getAttribute("href");
  expect(editPath).toMatch(/\/locations\/[0-9a-f-]+\/edit$/);
  const locationId = editPath!.split("/").at(-2);
  await editLink.click();
  await expect(
    page.getByRole("heading", { name: "Edit location", exact: true }),
  ).toBeVisible();
  await page.goto(`/workspace/${foreignOrg}/locations/${locationId}/edit`);
  await expect(
    page.getByRole("heading", { name: "Let’s find your workspace." }),
  ).toBeVisible();
  await page.goto(`${base}/new`);
  await page
    .getByRole("textbox", { name: "Location name", exact: true })
    .fill("Stale permission store");
  await page
    .getByRole("textbox", { name: "Location code", exact: true })
    .fill("STALE");
  await request.post(`${fixture}/__test/location-admin-role`, {
    data: { role: "viewer" },
  });
  try {
    await page
      .getByRole("button", { name: "Add location", exact: true })
      .click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Only business owners and admins",
    );
    await page.goto(base);
    await expect(
      page.getByRole("article", { name: "Stale permission store" }),
    ).toHaveCount(0);
  } finally {
    await request.post(`${fixture}/__test/location-admin-role`, {
      data: { role: "admin" },
    });
  }
  await page.goto(`${base}/${locationId}/edit`);
  await page
    .getByRole("textbox", { name: "Location name", exact: true })
    .fill("Central Kitchen & Store");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("article", { name: "Central Kitchen & Store", exact: true }),
  ).toBeVisible();
});

test("locations and their forms fit phone and desktop screens", async ({
  page,
}) => {
  await signIn(page);
  await mkdir(".tooling/previews", { recursive: true });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto(base);
    await expect(
      page.getByRole("heading", { name: "Locations", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.tooling/previews/locations-${width}.png`,
      fullPage: true,
      caret: "initial",
    });
    await page.goto(`${base}/new`);
    await expect(
      page.getByRole("textbox", { name: "Location code", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.tooling/previews/location-form-${width}.png`,
      fullPage: true,
      caret: "initial",
    });
  }
});

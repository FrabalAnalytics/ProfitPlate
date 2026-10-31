import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const tenant = "44444444-4444-4444-8444-444444444444";
const base = `/workspace/${tenant}/inventory`;
async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("ProfitPlate-test-2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(`/workspace/${tenant}`);
}
const input = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });
const select = (page: Page, name: string) =>
  page.getByRole("combobox", { name, exact: true });

test("imported catalogue prices are labelled and counted stock units retain their meaning", async ({
  page,
}) => {
  await signIn(page, "inventory-owner@profitplate.test");
  await page.goto(`${base}?view=items`);
  const row = page.getByRole("row").filter({
    has: page.getByRole("cell", {
      name: "Imported reference bottle",
      exact: true,
    }),
  });
  await expect(
    row.getByRole("cell", { name: "bottle", exact: true }),
  ).toBeVisible();
  await expect(row).toContainText("123.45");
  await expect(row).toContainText("Imported reference");
  await expect(
    page.getByRole("row").filter({
      has: page.getByRole("cell", {
        name: "Unconfirmed reference pack",
        exact: true,
      }),
    }),
  ).toContainText("Unconfirmed (0)");
  await page.setViewportSize({ width: 375, height: 960 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("operating areas, categories, independent approval, production and imported sales update live inventory", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  await signIn(page, "inventory-owner@profitplate.test");
  await page.goto(`${base}?view=controls`);
  await page
    .getByRole("button", { name: "Set up the three areas", exact: true })
    .click();
  await expect(
    page.getByText("main store: Main Store", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("kitchen: Kitchen", { exact: true }),
  ).toBeVisible();
  await select(page, "Business member").selectOption({
    label: "inventory-owner@profitplate.test",
  });
  await select(page, "Manager role").selectOption("operations_manager");
  await page
    .getByRole("button", { name: "Save manager appointment", exact: true })
    .click();
  await page.getByLabel("Start date", { exact: true }).fill("2026-01-01");
  await page.getByLabel("End date", { exact: true }).fill("2026-12-31");
  await page
    .getByRole("button", { name: "Create open period", exact: true })
    .click();
  await expect(
    page.getByText("2026-01-01 to 2026-12-31 · Open", { exact: true }),
  ).toBeVisible();
  for (const [name, sku, category, unit] of [
    ["Tomatoes", "TOM", "raw_material", "kg"],
    ["Sauce", "SAUCE", "semi_finished", "kg"],
    ["Tissue", "TISSUE", "general", "each"],
  ]) {
    await page.goto(`${base}?view=items`);
    await input(page, "Item name").fill(name);
    await input(page, "SKU").fill(sku);
    await select(page, "Category").selectOption(category);
    await select(page, "Base unit").selectOption(unit);
    await page
      .getByRole("button", { name: "Add inventory item", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: sku, exact: true }),
    ).toBeVisible();
  }
  const managerContext = await browser.newContext();
  const manager = await managerContext.newPage();
  await signIn(manager, "inventory-gm@profitplate.test");
  async function submitAndApprove(kind: string, reference: string) {
    const article = page.getByRole("article", {
      name: `${kind} ${reference}`,
      exact: true,
    });
    await article
      .getByRole("button", { name: "Submit for approval", exact: true })
      .click();
    await expect(
      page.getByRole("article", { name: `${kind} ${reference}`, exact: true }),
    ).toContainText("Self-approval is blocked.");
    await manager.goto(`${base}?view=documents`);
    if (kind === "sales")
      await manager
        .getByRole("row")
        .filter({ hasText: reference })
        .getByRole("link", { name: "Review", exact: true })
        .click();
    const managerArticle = manager.getByRole("article", {
      name: `${kind} ${reference}`,
      exact: true,
    });
    await expect(
      managerArticle.getByRole(
        "table",
        kind === "sales"
          ? { name: "Imported sales lines", exact: true }
          : undefined,
      ),
    ).toBeVisible();
    if (kind === "sales") {
      await expect(managerArticle.getByRole("alert")).toContainText(
        "Net sales are missing",
      );
      await expect(
        managerArticle
          .getByRole("heading", {
            name: "Recipe profit (NGN)",
            exact: true,
          })
          .locator(".."),
      ).toContainText("Unavailable");
    }
    await managerArticle
      .getByRole("button", {
        name: kind === "sales" ? "Approve sales and post" : "Approve and post",
        exact: true,
      })
      .click();
    await expect(
      manager.getByRole("article", {
        name: `${kind} ${reference}`,
        exact: true,
      }),
    ).toContainText("posted");
  }
  try {
    await page.goto(`${base}?view=documents&action=opening`);
    await input(page, "Reason / reference").fill("Opening test");
    await select(page, "Destination location").selectOption({
      label: "Kitchen",
    });
    await select(page, "Item 1").selectOption({ label: "Tomatoes (kg)" });
    await input(page, "Quantity 1").fill("10");
    await input(page, "Unit cost 1 (NGN)").fill("100");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await submitAndApprove("opening", "Opening test");
    await page.goto(`${base}?view=stock`);
    await expect(
      page.getByRole("row").filter({
        has: page.getByRole("cell", { name: "Tomatoes", exact: true }),
      }),
    ).toContainText("10.000 kg");
    await page.goto(`${base}?view=recipes`);
    const sub = page
      .getByRole("heading", { name: "Create a recipe", exact: true })
      .locator("..");
    await sub
      .getByRole("textbox", { name: "Recipe name", exact: true })
      .fill("Sauce recipe");
    await sub
      .getByRole("textbox", { name: "Recipe / menu code", exact: true })
      .fill("SAUCE");
    await sub
      .getByRole("combobox", { name: "Recipe type", exact: true })
      .selectOption("sub_recipe");
    await sub
      .getByRole("combobox", { name: "Semi-finished output SKU", exact: true })
      .selectOption({ label: "Sauce (kg)" });
    await sub
      .getByRole("textbox", { name: "Standard output quantity", exact: true })
      .fill("4");
    await sub
      .getByRole("combobox", { name: "Item 1", exact: true })
      .selectOption({ label: "Tomatoes (kg)" });
    await sub
      .getByRole("textbox", { name: "Quantity 1", exact: true })
      .fill("5");
    await sub.getByRole("button", { name: "Save recipe", exact: true }).click();
    const final = page
      .getByRole("heading", { name: "Create a recipe", exact: true })
      .locator("..");
    await final
      .getByRole("textbox", { name: "Recipe name", exact: true })
      .fill("Plate");
    await final
      .getByRole("textbox", { name: "Recipe / menu code", exact: true })
      .fill("PLATE");
    await final
      .getByRole("combobox", { name: "Recipe type", exact: true })
      .selectOption("final");
    await final
      .getByRole("textbox", { name: "Standard output quantity", exact: true })
      .fill("1");
    await final
      .getByRole("combobox", { name: "Item 1", exact: true })
      .selectOption({ label: "Sauce (kg)" });
    await final
      .getByRole("textbox", { name: "Quantity 1", exact: true })
      .fill("0.1");
    await final
      .getByRole("button", { name: "Add another item", exact: true })
      .click();
    await final
      .getByRole("combobox", { name: "Item 2", exact: true })
      .selectOption({ label: "Tomatoes (kg)" });
    await final
      .getByRole("textbox", { name: "Quantity 2", exact: true })
      .fill("0.15");
    await final
      .getByRole("button", { name: "Save recipe", exact: true })
      .click();
    await page.goto(`${base}?view=documents&action=production`);
    await input(page, "Reason / reference").fill("Sauce batch");
    await select(page, "Source location").selectOption({ label: "Kitchen" });
    await select(page, "Production recipe version").selectOption({ index: 1 });
    await input(page, "Planned output quantity").fill("4");
    await input(page, "Actual declared output quantity").fill("4");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await submitAndApprove("production", "Sauce batch");
    await page.goto(`${base}?view=sales`);
    await expect(
      page.getByLabel("Sales CSV file", { exact: true }),
    ).toBeEnabled();
    await page.getByLabel("Sales CSV file", { exact: true }).setInputFiles({
      name: "sales.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "external_id,menu_code,quantity,location\nreceipt-1:line-1,PLATE,2,KITCHEN\n",
      ),
    });
    await expect(page.getByRole("main").getByRole("status")).toContainText(
      "1 sales line ready",
    );
    await input(page, "Source system").fill("POS");
    await input(page, "Import reference / reason").fill("Daily sales");
    await page
      .getByRole("button", {
        name: "Validate and save sales draft",
        exact: true,
      })
      .click();
    await submitAndApprove("sales", "Daily sales");
    await page.goto(`${base}?view=stock`);
    await expect(
      page.getByRole("row").filter({
        has: page.getByRole("cell", { name: "Tomatoes", exact: true }),
      }),
    ).toContainText("4.700 kg");
    await expect(
      page.getByRole("row").filter({
        has: page.getByRole("cell", { name: "Sauce", exact: true }),
      }),
    ).toContainText("3.800 kg");
    await mkdir(".tooling/previews", { recursive: true });
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 960 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `.tooling/previews/inventory-${width}.png`,
        fullPage: true,
        caret: "initial",
      });
    }
    await page.goto(`${base}?view=movements`);
    await expect(
      page.getByRole("cell", { name: "production input", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "sales consumption", exact: true }),
    ).toHaveCount(2);
    await page.goto(`${base}?view=documents&action=receipt`);
    await input(page, "Reason / reference").fill("Latest purchase");
    await select(page, "Destination location").selectOption({
      label: "Kitchen",
    });
    await select(page, "Item 1").selectOption({ label: "Tomatoes (kg)" });
    await input(page, "Quantity 1").fill("1");
    await input(page, "Unit cost 1 (NGN)").fill("150");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await submitAndApprove("receipt", "Latest purchase");
    for (const view of ["items", "stock"]) {
      await page.goto(`${base}?view=${view}`);
      await expect(
        page.getByRole("columnheader", {
          name: "Last purchase price (NGN/base unit)",
          exact: true,
        }),
      ).toBeVisible();
      const row = page.getByRole("row").filter({
        has: page.getByRole("cell", { name: "Tomatoes", exact: true }),
      });
      await expect(
        row.getByRole("cell", { name: "150.00", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("row").filter({
          has: page.getByRole("cell", { name: "Sauce", exact: true }),
        }),
      ).toContainText("Produced in-house");
    }
  } finally {
    await managerContext.close();
  }
});

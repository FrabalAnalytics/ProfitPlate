import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const tenant = "55555555-5555-4555-8555-555555555555";
const base = `/workspace/${tenant}`;
async function login(page: Page, name: string) {
  await page.goto("/sign-in");
  await page
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill(`business-${name}@profitplate.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("ProfitPlate-test-2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(name === "recipient" ? "/setup" : base);
}
const input = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });
const select = (page: Page, name: string) =>
  page.getByRole("combobox", { name, exact: true });

test("procurement, independent receiving and approved department requests work across role screens", async ({
  page,
  browser,
}) => {
  test.setTimeout(240000);
  await login(page, "buyer");
  await expect(
    page.getByRole("heading", {
      name: "Procurement Officer workspace",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve", exact: true }),
  ).toHaveCount(0);
  await page.goto(`${base}/masters?view=vendors`);
  await input(page, "Vendor code").fill("TEST-SUPPLY");
  await input(page, "Vendor name").fill("Workflow Supplier");
  await page.getByRole("button", { name: "Save vendor", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Workflow Supplier", exact: true }),
  ).toBeVisible();
  await page.goto(`${base}/masters?view=vendor_items`);
  await select(page, "Vendor").selectOption({ label: "Workflow Supplier" });
  await select(page, "Inventory item").selectOption({
    label: "B-RICE · Workflow rice (kg)",
  });
  await input(page, "Purchase unit / pack").fill("bag");
  await input(page, "Base units per purchase unit").fill("10");
  await input(page, "Quoted price per purchase unit (NGN)").fill("1000");
  await input(page, "Pack specification / evidence").fill(
    "Test bag contains 10 kg",
  );
  await page
    .getByRole("button", { name: "Save supplier item", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "bag", exact: true }),
  ).toBeVisible();
  await page.goto(`${base}/purchasing`);
  await page
    .getByRole("link", { name: "Workflow Supplier", exact: true })
    .click();
  await input(page, "Reason / reference").fill("Service stock purchase");
  await select(page, "Item 1").selectOption({ index: 1 });
  await input(page, "Purchase quantity 1").fill("2");
  await input(page, "Price per purchase unit 1 (NGN)").fill("1000");
  await page
    .getByRole("button", { name: "Save purchase order draft", exact: true })
    .click();
  const po = page.getByRole("article", {
    name: "PO-1 Workflow Supplier",
    exact: true,
  });
  await po
    .getByRole("button", { name: "Submit order for approval", exact: true })
    .click();
  await expect(po).toContainText("submitted");
  await expect(
    po.getByText("Record accepted delivery", { exact: true }),
  ).toHaveCount(0);
  const gmContext = await browser.newContext(),
    storeContext = await browser.newContext(),
    kitchenContext = await browser.newContext();
  try {
    const gm = await gmContext.newPage(),
      store = await storeContext.newPage(),
      kitchen = await kitchenContext.newPage();
    await login(gm, "gm");
    await gm.goto(`${base}/approvals`);
    await gm.locator("summary").filter({ hasText: "PO-1" }).click();
    await gm.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(gm).toHaveURL(/purchasing/);
    await expect(
      gm.getByRole("article", { name: "PO-1 Workflow Supplier", exact: true }),
    ).toContainText("approved");
    await expect(
      gm.getByRole("heading", { name: "New purchase order", exact: true }),
    ).toHaveCount(0);
    await gm.goto(`${base}/masters?view=vendors`);
    await expect(
      gm.getByRole("cell", { name: "Workflow Supplier", exact: true }),
    ).toBeVisible();
    await expect(
      gm.getByRole("button", { name: "Save vendor", exact: true }),
    ).toHaveCount(0);
    await login(store, "store");
    await store.goto(`${base}/purchasing`);
    await store.getByRole("link", {name:"Open PO-1",exact:true}).click();
    await store.getByText("Record accepted delivery", { exact: true }).click();
    await select(store, "Receiving location").selectOption({
      label: "Main Store",
    });
    await input(store, "Reason / reference").fill("Accepted bags");
    await select(store, "Item 1").selectOption({ index: 1 });
    await input(store, "Accepted purchase quantity 1").fill("1");
    await store
      .getByRole("button", {
        name: "Accept delivery and update stock",
        exact: true,
      })
      .click();
    await expect(store).toHaveURL(/purchasing/);
    await expect(store.getByRole("status")).toContainText(
      "Delivery accepted. Stock updated.",
    );
    await expect(
      store.getByRole("article", {
        name: "PO-1 Workflow Supplier",
        exact: true,
      }),
    ).toContainText("approved");
    const legacy = await store.request.post(
      "http://127.0.0.1:54329/__test/legacy-purchase-receipt",
    );
    expect(legacy.ok()).toBe(true);
    await gm.goto(`${base}/approvals`);
    await expect(
      gm.locator("summary").filter({ hasText: "Accepted bags" }),
    ).toHaveCount(0);
    await expect(
      gm.locator("summary").filter({ hasText: "Legacy pending bags" }),
    ).toHaveCount(0);
    await store.goto(`${base}/purchasing`);
    await store.getByRole("link", {name:"Open PO-1",exact:true}).click();
    await store
      .getByRole("link", { name: "Review recorded delivery", exact: true })
      .click();
    const saved = store.getByRole("article", {
      name: "receipt Legacy pending bags",
      exact: true,
    });
    await expect(
      saved.getByRole("button", { name: "Submit for approval", exact: true }),
    ).toHaveCount(0);
    await saved
      .getByRole("button", {
        name: "Accept delivery and update stock",
        exact: true,
      })
      .click();
    await store.getByRole("link", {name:"Open PO-1",exact:true}).click();
    await expect(
      store.getByRole("article", {
        name: "PO-1 Workflow Supplier",
        exact: true,
      }),
    ).toContainText("Fulfilled");
    await store.goto(`${base}/inventory?view=stock`);
    await expect(
      store.getByRole("row").filter({
        has: store.getByRole("cell", { name: "Workflow rice", exact: true }),
      }),
    ).toContainText("20.000 kg");
    await login(kitchen, "kitchen");
    await kitchen.goto(`${base}/requests`);
    await expect(select(kitchen, "Requesting location")).toHaveValue(/.+/);
    await input(kitchen, "Reason / reference").fill("Rice for service");
    await select(kitchen, "Item 1").selectOption({ index: 1 });
    await input(kitchen, "Quantity 1").fill("4");
    await kitchen
      .getByRole("button", { name: "Save request draft", exact: true })
      .click();
    await kitchen
      .getByRole("button", { name: "Submit request", exact: true })
      .click();
    await gm.goto(`${base}/approvals`);
    await gm.locator("summary").filter({ hasText: "Rice for service" }).click();
    await gm.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(gm).toHaveURL(/requests/);
    await store.goto(`${base}/requests`);
    await store.getByRole("link", {name:"Open REQ-1",exact:true}).click();
    await store.getByText("Dispatch approved stock", { exact: true }).click();
    const dispatch = store.getByRole("article", {
      name: "Request 1 Rice for service",
      exact: true,
    });
    await expect(
      dispatch.getByRole("textbox", { name: "Quantity 1", exact: true }),
    ).toHaveValue("4.000");
    await dispatch
      .getByRole("textbox", { name: "Reason / reference", exact: true })
      .fill("Service dispatch");
    await dispatch
      .getByRole("button", { name: "Dispatch entered quantities", exact: true })
      .click();
    await expect(store.getByRole("status")).toContainText(
      "Stock dispatched and reserved",
    );
    await store.goto(`${base}/inventory?view=stock`);
    const stockRow = store.getByRole("row").filter({
      has: store.getByRole("cell", { name: "Workflow rice", exact: true }),
    });
    await expect(stockRow).toContainText("20.000 kg");
    await expect(
      stockRow.getByRole("cell", { name: "4.000", exact: true }),
    ).toBeVisible();
    await kitchen.goto(`${base}/requests`);
    const transfer = kitchen.getByRole("article", {
      name: "Delivery Service dispatch",
      exact: true,
    });
    await transfer
      .getByText("Confirm received quantities", { exact: true })
      .click();
    const receive = transfer.locator("details").filter({
      has: kitchen.locator("summary", {
        hasText: "Confirm received quantities",
      }),
    });
    await receive
      .getByRole("textbox", { name: "Reason / reference", exact: true })
      .fill("Three kg accepted");
    await receive
      .getByRole("combobox", { name: "Item 1", exact: true })
      .selectOption({ index: 1 });
    await receive
      .getByRole("textbox", { name: "Quantity 1", exact: true })
      .fill("3");
    await receive
      .getByRole("button", { name: "Confirm receipt", exact: true })
      .click();
    await expect(kitchen.getByRole("status")).toContainText(
      "Accepted quantities posted",
    );
    await kitchen.goto(`${base}/requests`);
    await transfer
      .getByText("Reject delivery quantities", { exact: true })
      .click();
    const reject = transfer.locator("details").filter({
      has: kitchen.locator("summary", {
        hasText: "Reject delivery quantities",
      }),
    });
    await reject
      .getByRole("textbox", { name: "Reason / reference", exact: true })
      .fill("One kg damaged");
    await reject
      .getByRole("combobox", { name: "Item 1", exact: true })
      .selectOption({ index: 1 });
    await reject
      .getByRole("textbox", { name: "Quantity 1", exact: true })
      .fill("1");
    await reject
      .getByRole("button", { name: "Reject entered quantities", exact: true })
      .click();
    await expect(kitchen.getByRole("status")).toContainText(
      "Rejection recorded",
    );
    await store.goto(`${base}/requests`);
    await store.getByRole("link", {name:"Open REQ-1",exact:true}).click();
    const returned = store.getByRole("article", {
      name: "Delivery Service dispatch",
      exact: true,
    });
    await returned
      .getByText("Confirm rejected goods returned to Store", { exact: true })
      .click();
    const back = returned.locator("details");
    await back
      .getByRole("textbox", { name: "Reason / reference", exact: true })
      .fill("Damaged bag returned");
    await back
      .getByRole("combobox", { name: "Item 1", exact: true })
      .selectOption({ index: 1 });
    await back
      .getByRole("textbox", { name: "Quantity 1", exact: true })
      .fill("1");
    await back
      .getByRole("button", { name: "Confirm returned quantities", exact: true })
      .click();
    await expect(store.getByRole("status")).toContainText("Return confirmed");
    await store.goto(`${base}/requests`);
    await store.getByRole("link", {name:"Open REQ-1",exact:true}).click();
    await expect(returned).toContainText("received");
    await dispatch
      .getByText("Dispatch approved stock", { exact: true })
      .click();
    await dispatch
      .getByRole("textbox", { name: "Quantity 1", exact: true })
      .fill("1");
    await dispatch
      .getByRole("textbox", { name: "Reason / reference", exact: true })
      .fill("Replacement service dispatch");
    await dispatch
      .getByRole("button", { name: "Dispatch entered quantities", exact: true })
      .click();
    await expect(store.getByRole("status")).toContainText(
      "Stock dispatched and reserved",
    );
    await kitchen.goto(`${base}/requests`);
    const replacement = kitchen.getByRole("article", {
      name: "Delivery Replacement service dispatch",
      exact: true,
    });
    await replacement
      .getByText("Confirm received quantities", { exact: true })
      .click();
    const accept = replacement.locator("details").filter({
      has: kitchen.locator("summary", {
        hasText: "Confirm received quantities",
      }),
    });
    await accept
      .getByRole("textbox", { name: "Reason / reference", exact: true })
      .fill("Replacement accepted");
    await accept
      .getByRole("combobox", { name: "Item 1", exact: true })
      .selectOption({ index: 1 });
    await accept
      .getByRole("textbox", { name: "Quantity 1", exact: true })
      .fill("1");
    await accept
      .getByRole("button", { name: "Confirm receipt", exact: true })
      .click();
    await expect(kitchen.getByRole("status")).toContainText(
      "Accepted quantities posted",
    );
    await kitchen.goto(`${base}/inventory?view=stock`);
    await expect(
      kitchen.getByRole("row").filter({
        has: kitchen.getByRole("cell", {
          name: "Workflow rice",
          exact: true,
        }),
      }),
    ).toContainText("4.000 kg");
    await expect(
      kitchen.getByRole("cell", { name: "Main Store", exact: true }),
    ).toHaveCount(0);
    await mkdir(".tooling/previews", { recursive: true });
    for (const width of [375, 1440]) {
      await kitchen.setViewportSize({ width, height: 960 });
      expect(
        await kitchen.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await kitchen.screenshot({
        path: `.tooling/previews/kitchen-role-${width}.png`,
        fullPage: true,
      });
    }
  } finally {
    await gmContext.close();
    await storeContext.close();
    await kitchenContext.close();
  }
});

test("owner can issue a manual test invitation and recipient joins with the assigned role", async ({
  page,
  browser,
}) => {
  await login(page, "owner");
  await page.goto(`${base}/team`);
  await input(page, "Invited email").fill(
    "business-recipient@profitplate.test",
  );
  await select(page, "Working role").selectOption("procurement_officer");
  await page
    .getByRole("button", { name: "Generate invitation code", exact: true })
    .click();
  const code = await page
    .getByLabel("Invitation access code", { exact: true })
    .inputValue();
  expect(code).toMatch(/^[\da-f-]+\.[\da-f-]+\.[\da-f]{64}$/);
  const context = await browser.newContext();
  try {
    const recipient = await context.newPage();
    await login(recipient, "recipient");
    await recipient.goto("/join");
    await recipient
      .getByLabel("Business access code", { exact: true })
      .fill(code);
    await recipient
      .getByRole("button", { name: "Join business", exact: true })
      .click();
    await expect(recipient).toHaveURL(base);
    await expect(
      recipient.getByRole("heading", {
        name: "Procurement Officer workspace",
        exact: true,
      }),
    ).toBeVisible();
    for (const view of ["final_recipes", "sub_recipes"]) {
      await recipient.goto(`${base}/inventory?view=${view}`);
      await expect(
        recipient.getByRole("heading", {
          name:
            view === "final_recipes"
              ? "Final recipe master"
              : "Sub-recipe master",
          exact: true,
        }),
      ).toBeVisible();
    }
    await page.goto(`${base}/masters?view=units`);
    await expect(
      page.getByRole("heading", {
        name: "Units and conversion master",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

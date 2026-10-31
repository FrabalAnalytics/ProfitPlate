import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
const tenant = "66666666-6666-4666-8666-666666666666",
  base = `/workspace/${tenant}`;
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
async function login(page: Page, name: string) {
  await page.goto("/sign-in");
  await page
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill(`report-${name}@profitplate.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("ProfitPlate-test-2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(base);
}
const input = (p: Page, n: string) =>
  p.getByRole("textbox", { name: n, exact: true });
test("net sales import, independent reconciliation, immutable report publication and CSV export", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  await login(page, "store");
  await page.goto(`${base}/inventory?view=sales`);
  await expect(page.getByLabel("Sales CSV file")).toBeEnabled();
  await page.getByLabel("Sales CSV file").setInputFiles({
    name: "sales-with-revenue.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "external_id,menu_code,quantity,location,net_sales\nREPORT-1,REPORT-MEAL,3,KITCHEN,1500\n",
    ),
  });
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "1 sales line ready",
  );
  await input(page, "Source system").fill("POS");
  await input(page, "Import reference / reason").fill("Report golden sale");
  await page.getByLabel("Sales business date", { exact: true }).fill(yesterday);
  await page
    .getByRole("button", { name: "Validate and save sales draft", exact: true })
    .click();
  await page
    .getByRole("article", { name: "sales Report golden sale", exact: true })
    .getByRole("button", { name: "Submit for approval", exact: true })
    .click();
  const opsContext = await browser.newContext(),
    financeContext = await browser.newContext(),
    ownerContext = await browser.newContext();
  try {
    const ops = await opsContext.newPage(),
      finance = await financeContext.newPage(),
      owner = await ownerContext.newPage();
    await login(ops, "ops");
    await ops.goto(`${base}/approvals`);
    await ops
      .getByRole("row")
      .filter({ hasText: "Report golden sale" })
      .getByRole("link", { name: "Review", exact: true })
      .click();
    const salesReview = ops.getByRole("region", {
      name: "Sales review",
      exact: true,
    });
    await expect(
      salesReview
        .getByRole("heading", { name: "Net sales (NGN)", exact: true })
        .locator(".."),
    ).toContainText(/1500\.00(?!\d)/);
    await expect(
      salesReview
        .getByRole("heading", {
          name: "Recipe COGS (NGN)",
          exact: true,
        })
        .locator(".."),
    ).toContainText(/600\.00(?!\d)/);
    await expect(
      salesReview
        .getByRole("heading", {
          name: "Recipe profit (NGN)",
          exact: true,
        })
        .locator(".."),
    ).toContainText(/900\.00(?!\d)/);
    await expect(
      salesReview
        .getByRole("heading", { name: "Margin", exact: true })
        .locator(".."),
    ).toContainText("60.00%");
    await expect(
      salesReview.getByRole("table", {
        name: "Imported sales lines",
        exact: true,
      }),
    ).toContainText("REPORT-MEAL");
    await expect(
      salesReview.getByRole("searchbox", {
        name: "Search sales lines",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      salesReview.getByRole("combobox", {
        name: "Lines per page",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      salesReview.getByRole("heading", {
        name: "Sales summary 1 sales line",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      salesReview.getByRole("table", {
        name: "Ingredient deductions",
        exact: true,
      }),
    ).toBeHidden();
    await ops
      .getByRole("button", { name: "Approve sales and post", exact: true })
      .click();
    await expect(
      ops.getByRole("article", {
        name: "sales Report golden sale",
        exact: true,
      }),
    ).toContainText("posted");
    const postedReview = ops.getByRole("article", {
      name: "sales Report golden sale",
      exact: true,
    });
    await expect(
      postedReview
        .getByRole("heading", {
          name: "Recipe COGS (NGN)",
          exact: true,
        })
        .locator(".."),
    ).toContainText(/600\.00(?!\d)/);
    await mkdir(".tooling/previews", { recursive: true });
    for (const width of [375, 1440]) {
      await ops.setViewportSize({ width, height: 960 });
      expect(
        await ops.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await postedReview.screenshot({
        path: `.tooling/previews/sales-focused-one-${width}.png`,
      });
    }
    await ops.goto(`${base}/sales/11111111-1111-4111-8111-111111111111`);
    await expect(
      ops.getByText("PAGE UNAVAILABLE", { exact: true }),
    ).toBeVisible();
    await expect(
      ops.getByRole("region", { name: "Sales review", exact: true }),
    ).toHaveCount(0);
    await ops.goto(`${base}/sales/not-a-document`);
    await expect(
      ops.getByText("PAGE UNAVAILABLE", { exact: true }),
    ).toBeVisible();
    await login(owner, "owner");
    await owner.goto(`${base}/reports?start=${yesterday}&end=${yesterday}`);
    await expect(
      owner
        .getByRole("heading", { name: "Theoretical COGS", exact: true })
        .locator("../.."),
    ).toContainText(/600\.00(?!\d)/);
    await expect(
      owner
        .getByRole("heading", { name: "Theoretical gross profit", exact: true })
        .locator("../.."),
    ).toContainText(/900\.00(?!\d)/);
    await expect(
      owner
        .getByRole("heading", { name: "Finance-reconciled COGS", exact: true })
        .locator(".."),
    ).toContainText("Unavailable");
    await login(finance, "finance");
    await finance.goto(`${base}/reports?start=${yesterday}&end=${yesterday}`);
    await finance
      .getByRole("link", { name: "Finance review", exact: true })
      .click();
    await input(finance, "Reconciled POS line count").fill("1");
    await input(finance, "Reconciled net sales (NGN)").fill("1500");
    await input(finance, "Actual COGS (NGN)").fill("700");
    await input(finance, "Actual food cost (NGN)").fill("650");
    await input(finance, "Supporting evidence reference").fill(
      "Test accounting schedule R-1",
    );
    const reconcile = finance
      .getByRole("heading", {
        name: "Submit Finance reconciliation",
        exact: true,
      })
      .locator("..");
    await reconcile
      .getByRole("textbox", { name: "Reason / reference", exact: true })
      .fill("Test POS and COGS reconciled");
    await finance
      .getByRole("button", { name: "Submit reconciliation", exact: true })
      .click();
    await expect(
      finance
        .getByRole("heading", {
          name: "Accounting reconciliations",
          exact: true,
        })
        .locator(".."),
    ).toContainText("submitted");
    await expect(
      finance.getByRole("button", {
        name: "Approve reconciliation",
        exact: true,
      }),
    ).toHaveCount(0);
    await ops.goto(`${base}/reports?start=${yesterday}&end=${yesterday}`);
    await ops
      .getByRole("link", { name: "Finance review", exact: true })
      .click();
    await ops
      .getByRole("button", { name: "Approve reconciliation", exact: true })
      .click();
    await expect(
      ops
        .getByRole("heading", { name: "Finance-reconciled COGS", exact: true })
        .locator(".."),
    ).toContainText(/700\.00(?!\d)/);
    await expect(
      ops
        .getByRole("heading", { name: "Gross profit", exact: true })
        .locator(".."),
    ).toContainText(/800\.00(?!\d)/);
    await expect(ops.getByText("53.33%", { exact: true })).toBeVisible();
    await expect(
      ops.getByRole("heading", {
        name: "Submit Finance reconciliation",
        exact: true,
      }),
    ).toHaveCount(0);
    await mkdir(".tooling/previews", { recursive: true });
    for (const width of [1440, 375]) {
      await ops.setViewportSize({ width, height: 960 });
      expect(
        await ops.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await ops.screenshot({
        path: `.tooling/previews/report-overview-${width}.png`,
        fullPage: true,
      });
    }
    await ops.getByRole("link", { name: "Saved reports", exact: true }).click();
    const publish = ops
      .getByRole("heading", { name: "Publish a report snapshot", exact: true })
      .locator("..");
    await publish
      .getByRole("textbox", { name: "Reason / reference", exact: true })
      .fill("Reconciled management report");
    await publish
      .getByRole("button", { name: "Publish snapshot", exact: true })
      .click();
    const saved = ops
      .getByRole("heading", { name: "Published reports", exact: true })
      .locator("..");
    await saved
      .getByRole("link", { name: "View saved report", exact: true })
      .click();
    await expect(ops).toHaveURL(/snapshot=/);
    await expect(ops.getByText(/Published · revision 1/)).toBeVisible();
    const download = ops.waitForEvent("download");
    await ops
      .getByRole("link", { name: "Download spreadsheet (CSV)", exact: true })
      .click();
    const exported = await download;
    expect(exported.suggestedFilename()).toContain("v1.csv");
    const downloadedPath = await exported.path();
    expect(downloadedPath).toBeTruthy();
    const exportedCsv = await readFile(downloadedPath!, "utf8");
    expect(exportedCsv).toContain('"600.00"');
    expect(exportedCsv).toContain('"53.33"');
    expect(exportedCsv).toContain('"4.000"');
    await mkdir(".tooling/previews", { recursive: true });
    for (const width of [375, 1440]) {
      await ops.setViewportSize({ width, height: 960 });
      expect(
        await ops.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await ops.screenshot({
        path: `.tooling/previews/report-${width}.png`,
        fullPage: true,
      });
    }
  } finally {
    await opsContext.close();
    await financeContext.close();
    await ownerContext.close();
  }
});
test("department count adjusts stock only after independent Operations approval", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  await login(page, "kitchen");
  await page.goto(`${base}/counts`);
  await page
    .getByRole("combobox", { name: "Count location", exact: true })
    .selectOption({ label: "Kitchen" });
  await input(page, "Reason / reference").fill("Kitchen physical count");
  await page
    .getByRole("combobox", { name: "Item 1", exact: true })
    .selectOption({ label: "Reporting rice (kg)" });
  await input(page, "Physical quantity 1").fill("3");
  await page
    .getByRole("button", { name: "Save count draft", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Submit count for approval", exact: true })
    .click();
  await expect(
    page.getByRole("article", {
      name: "Count Kitchen physical count",
      exact: true,
    }),
  ).toContainText("Waiting for a different Operations Manager");
  const context = await browser.newContext();
  try {
    const ops = await context.newPage();
    await login(ops, "ops");
    await ops.goto(`${base}/counts`);
    await ops
      .getByRole("button", { name: "Approve count adjustment", exact: true })
      .click();
    await expect(
      ops.getByRole("article", {
        name: "Count Kitchen physical count",
        exact: true,
      }),
    ).toContainText("posted");
  } finally {
    await context.close();
  }
  await page.goto(`${base}/inventory?view=stock`);
  await expect(
    page.getByRole("row").filter({
      has: page.getByRole("cell", { name: "Reporting rice", exact: true }),
    }),
  ).toContainText("3.000 kg");
  await page.goto(`${base}/reports?start=${yesterday}&end=${yesterday}`);
  await expect(
    page.getByRole("heading", { name: "Gross profit", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "Inventory details", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Finance review", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: "Inventory at the reporting cutoff",
      exact: true,
    }),
  ).toBeVisible();
});
test("administrator has setup access without financial reporting or implicit inventory posting", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto(`${base}/team`);
  await expect(
    page.getByRole("heading", { name: "Team and access", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "General Manager", exact: true }),
  ).toHaveCount(0);
  await page.goto(`${base}/inventory?view=documents&action=receipt`);
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toHaveCount(0);
  await page.goto(`${base}/reports`);
  await expect(
    page.getByRole("heading", { name: "Gross profit", exact: true }),
  ).toHaveCount(0);
});

test("sixty-line sales batches stay compact and filtering never changes approval totals", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  await login(page, "store");
  await page.goto(`${base}/inventory?view=sales`);
  const csv =
    "external_id,menu_code,quantity,location,net_sales\n" +
    Array.from(
      { length: 60 },
      (_, i) =>
        `BULK-LINE-${String(i + 1).padStart(3, "0")},REPORT-MEAL,0.01,KITCHEN,5`,
    ).join("\n") +
    "\n";
  await expect(page.getByLabel("Sales CSV file")).toBeEnabled();
  await page.getByLabel("Sales CSV file").setInputFiles({
    name: "sixty-sales.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await input(page, "Source system").fill("BULK-POS");
  await input(page, "Import reference / reason").fill(
    "Sixty-line approval test",
  );
  await page.getByLabel("Sales business date", { exact: true }).fill(yesterday);
  await page
    .getByRole("button", { name: "Validate and save sales draft", exact: true })
    .click();
  const draft = page.getByRole("article", {
    name: "sales Sixty-line approval test",
    exact: true,
  });
  const table = draft.getByRole("table", {
    name: "Imported sales lines",
    exact: true,
  });
  await expect(table.locator("tbody tr")).toHaveCount(15);
  await expect(
    table.getByRole("cell", { name: "5.00", exact: true }),
  ).toHaveCount(15);
  await expect(
    table.getByRole("cell", { name: "0.010", exact: true }),
  ).toHaveCount(15);
  await expect(
    draft
      .getByRole("heading", { name: "Net sales (NGN)", exact: true })
      .locator(".."),
  ).toContainText(/300\.00(?!\d)/);
  await draft
    .getByRole("region", { name: "Scrollable sales table", exact: true })
    .evaluate((el) => {
      el.scrollTop = 1000;
    });
  await draft.getByRole("button", { name: "Next", exact: true }).click();
  expect(
    await draft
      .getByRole("region", { name: "Scrollable sales table", exact: true })
      .evaluate((el) => el.scrollTop),
  ).toBe(0);
  await expect(draft.getByText("Page 2 of 4", { exact: true })).toBeVisible();
  await expect(table).toContainText("BULK-LINE-016");
  await draft
    .getByRole("searchbox", { name: "Search sales lines", exact: true })
    .fill("BULK-LINE-060");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText("BULK-LINE-060");
  await expect(
    draft
      .getByRole("heading", { name: "Net sales (NGN)", exact: true })
      .locator(".."),
  ).toContainText(/300\.00(?!\d)/);
  await draft
    .getByRole("searchbox", { name: "Search sales lines", exact: true })
    .fill("No matching dish");
  await expect(
    draft.getByText("No sales lines match your search.", { exact: true }),
  ).toBeVisible();
  await draft
    .getByRole("searchbox", { name: "Search sales lines", exact: true })
    .fill("");
  await draft
    .getByRole("combobox", { name: "Lines per page", exact: true })
    .selectOption("60");
  await expect(table.locator("tbody tr")).toHaveCount(60);
  const scroll = draft.getByRole("region", {
    name: "Scrollable sales table",
    exact: true,
  });
  expect(
    await scroll.evaluate((el) => el.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(422);
  await mkdir(".tooling/previews", { recursive: true });
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 960 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const metrics = draft
      .getByRole("heading", { name: "Net sales (NGN)", exact: true })
      .locator("../..");
    expect(
      await metrics.evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      ),
    ).toBe(width === 1440 ? 4 : 2);
    expect(
      await draft
        .locator("dl")
        .first()
        .evaluate((el) => getComputedStyle(el).display),
    ).toBe("grid");
    if (width === 375) {
      const cards = draft.getByRole("list", {
        name: "Imported sales lines",
        exact: true,
      });
      await expect(cards).toBeVisible();
      await expect(cards.getByRole("listitem")).toHaveCount(60);
      await expect(cards.getByRole("listitem").first()).toContainText(
        /5\.00(?!\d)/,
      );
      await expect(cards.getByRole("listitem").first()).toContainText(
        /2\.00(?!\d)/,
      );
    }
    await draft.screenshot({
      path: `.tooling/previews/sales-sixty-${width}.png`,
    });
  }
  await draft
    .getByRole("button", { name: "Submit for approval", exact: true })
    .click();
  const context = await browser.newContext();
  try {
    const manager = await context.newPage();
    await login(manager, "ops");
    await manager.goto(`${base}/approvals`);
    await manager
      .getByRole("row")
      .filter({ hasText: "Sixty-line approval test" })
      .getByRole("link", { name: "Review", exact: true })
      .click();
    const review = manager.getByRole("region", {
      name: "Sales review",
      exact: true,
    });
    await review
      .getByRole("searchbox", { name: "Search sales lines", exact: true })
      .fill("BULK-LINE-060");
    await expect(
      review
        .getByRole("table", { name: "Imported sales lines", exact: true })
        .locator("tbody tr"),
    ).toHaveCount(1);
    await expect(
      review.getByText(/Approval and batch totals cover all 60 imported lines/),
    ).toBeVisible();
    await manager
      .getByRole("button", { name: "Approve sales and post", exact: true })
      .click();
    const posted = manager.getByRole("article", {
      name: "sales Sixty-line approval test",
      exact: true,
    });
    await expect(posted).toContainText("posted");
    await expect(
      posted
        .getByRole("heading", { name: "Net sales (NGN)", exact: true })
        .locator(".."),
    ).toContainText(/300\.00(?!\d)/);
    await expect(
      posted
        .getByRole("heading", {
          name: "Recipe COGS (NGN)",
          exact: true,
        })
        .locator(".."),
    ).toContainText(/120\.00(?!\d)/);
    await posted
      .getByRole("searchbox", { name: "Search sales lines", exact: true })
      .fill("");
    await posted
      .getByRole("combobox", { name: "Lines per page", exact: true })
      .selectOption("60");
    await expect(
      posted
        .getByRole("table", { name: "Imported sales lines", exact: true })
        .locator("tbody tr"),
    ).toHaveCount(60);
    await manager
      .getByRole("link", { name: "Back to sales batches", exact: true })
      .click();
    const batch = manager
      .getByRole("row")
      .filter({ hasText: "Sixty-line approval test" });
    await expect(batch).toContainText(/300\.00(?!\d)/);
    await expect(batch).toContainText("posted");
    await expect(
      manager.getByRole("region", { name: "Sales review", exact: true }),
    ).toHaveCount(0);
    await manager.setViewportSize({ width: 375, height: 960 });
    const mobileBatch = manager.getByRole("article", {
      name: "Sales batch Sixty-line approval test",
      exact: true,
    });
    await expect(mobileBatch).toBeVisible();
    await expect(mobileBatch).toContainText(/300\.00(?!\d)/);
    expect(
      await manager.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await mobileBatch
      .getByRole("link", { name: "Review", exact: true })
      .click();
    await expect(
      manager.getByRole("article", {
        name: "sales Sixty-line approval test",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

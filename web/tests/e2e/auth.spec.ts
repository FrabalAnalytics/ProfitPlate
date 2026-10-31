import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { networkInterfaces } from "node:os";
const org = "11111111-1111-4111-8111-111111111111";
const otherOrg = "22222222-2222-4222-8222-222222222222";
const password = "ProfitPlate-test-2026!";
const fixtureOrigin = "http://127.0.0.1:54329";
async function signIn(page: Page, email = "owner@profitplate.test") {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("clock drift blocks stale-form login without spending token requests and recovers after sync", async ({
  page,
  context,
  request,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("other@profitplate.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await request.post(`${fixtureOrigin}/__test/auth-limits`, {
    data: { clockSkewSeconds: -4 * 3600, resetMetrics: true },
  });
  try {
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "incorrect clock",
    );
    await page.reload();
    await expect(page).toHaveURL("/auth/unavailable?reason=clock");
    await expect(
      page.getByRole("heading", { name: "Check the computer’s clock." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Start a fresh sign-in" }).click();
    await expect(page).toHaveURL("/auth/unavailable?reason=clock");
    const blocked = await (
      await request.get(`${fixtureOrigin}/__test/metrics`)
    ).json();
    expect(blocked.password).toBe(0);
    expect(blocked.refresh).toBe(0);
    expect(
      (await context.cookies()).filter((cookie) =>
        cookie.name.startsWith("sb-127-auth-token"),
      ),
    ).toHaveLength(0);
    await request.post(`${fixtureOrigin}/__test/auth-limits`, { data: {} });
    await page.getByRole("link", { name: "Return to sign in" }).click();
    await expect(page).toHaveURL("/sign-in");
    await signIn(page, "other@profitplate.test");
    await expect(page).toHaveURL(`/workspace/${otherOrg}`);
  } finally {
    await request.post(`${fixtureOrigin}/__test/auth-limits`, { data: {} });
  }
});

test("repeated sign-out and sign-in avoid Auth user lookups, even during logout throttling", async ({
  page,
  request,
}) => {
  await request.post(`${fixtureOrigin}/__test/auth-limits`, {
    data: { user: true, resetMetrics: true },
  });
  try {
    for (let index = 0; index < 3; index++) {
      await signIn(page, "other@profitplate.test");
      await expect(page).toHaveURL(`/workspace/${otherOrg}`);
      await page
        .getByRole("navigation", { name: "Workspace" })
        .getByRole("link", { name: "Business settings" })
        .click();
      await expect(
        page.getByRole("heading", { name: "Business settings", exact: true }),
      ).toBeVisible();
      if (index === 2)
        await request.post(`${fixtureOrigin}/__test/auth-limits`, {
          data: { user: true, logout: true },
        });
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(page).toHaveURL("/sign-in");
    }
    const metrics = await (
      await request.get(`${fixtureOrigin}/__test/metrics`)
    ).json();
    expect(metrics.user).toBe(0);
    expect(metrics.password).toBe(3);
    expect(metrics.logout).toBe(3);
  } finally {
    await request.post(`${fixtureOrigin}/__test/auth-limits`, { data: {} });
  }
});

test("an expired session can sign out when token refresh is throttled", async ({
  page,
  context,
  request,
}) => {
  await signIn(page, "other@profitplate.test");
  await expect(page).toHaveURL(`/workspace/${otherOrg}`);
  const sessionCookies = (await context.cookies())
    .filter((cookie) => /^sb-127-auth-token(?:\.\d+)?$/.test(cookie.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const encoded = sessionCookies.map((cookie) => cookie.value).join("");
  const session = JSON.parse(
    Buffer.from(encoded.slice("base64-".length), "base64url").toString(),
  );
  session.expires_at = Math.floor(Date.now() / 1000) - 300;
  await context.clearCookies({ name: /^sb-127-auth-token(?:\.\d+)?$/ });
  await context.addCookies([
    {
      name: "sb-127-auth-token",
      value:
        "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"),
      url: "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await request.post(`${fixtureOrigin}/__test/auth-limits`, {
    data: { refresh: true, resetMetrics: true },
  });
  try {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL("/sign-in");
    expect(
      (await context.cookies()).filter((cookie) =>
        cookie.name.startsWith("sb-127-auth-token"),
      ),
    ).toHaveLength(0);
    const metrics = await (
      await request.get(`${fixtureOrigin}/__test/metrics`)
    ).json();
    expect(metrics.refresh).toBeGreaterThan(0);
    await request.post(`${fixtureOrigin}/__test/auth-limits`, { data: {} });
    await signIn(page, "other@profitplate.test");
    await expect(page).toHaveURL(`/workspace/${otherOrg}`);
  } finally {
    await request.post(`${fixtureOrigin}/__test/auth-limits`, { data: {} });
  }
});

test("password throttling gives a clear message and permits sign-in after recovery", async ({
  page,
  request,
}) => {
  await request.post(`${fixtureOrigin}/__test/auth-limits`, {
    data: { password: true },
  });
  try {
    await signIn(page, "other@profitplate.test");
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "temporarily limiting requests",
    );
    await expect(page).toHaveURL("/sign-in");
    await request.post(`${fixtureOrigin}/__test/auth-limits`, { data: {} });
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(`/workspace/${otherOrg}`);
  } finally {
    await request.post(`${fixtureOrigin}/__test/auth-limits`, { data: {} });
  }
});

test("account throttling shows a stable status page without an authentication loop", async ({
  page,
  request,
}) => {
  await request.post(`${fixtureOrigin}/__test/auth-limits`, {
    data: { account: true, resetMetrics: true },
  });
  try {
    await signIn(page, "other@profitplate.test");
    await expect(page).toHaveURL("/auth/unavailable?reason=rate-limit");
    await expect(page.getByRole("status")).toContainText(
      "temporarily limiting requests",
    );
    const before = await (
      await request.get(`${fixtureOrigin}/__test/metrics`)
    ).json();
    await page.reload();
    await page.reload();
    const after = await (
      await request.get(`${fixtureOrigin}/__test/metrics`)
    ).json();
    expect(after.account).toBe(before.account);
    expect(after.user).toBe(0);
    await request.post(`${fixtureOrigin}/__test/auth-limits`, { data: {} });
    await page.getByRole("link", { name: "Return to sign in" }).click();
    await expect(page).toHaveURL(`/workspace/${otherOrg}`);
  } finally {
    await request.post(`${fixtureOrigin}/__test/auth-limits`, { data: {} });
  }
});

test("native sign-in POST retains its origin and passes Server Action checks", async ({
  page,
}) => {
  await page.goto("/sign-in");
  const expectedOrigin = new URL(page.url()).origin;
  const html = await (await page.request.get("/sign-in")).text();
  const submitted = page.waitForRequest(
    (request) => request.method() === "POST" && request.isNavigationRequest(),
  );
  // Submit the server-rendered form natively, without React's fetch handler.
  // Mobile/non-hydrated forms must satisfy the same Origin checks as hydrated forms.
  await page.evaluate(
    ({ html, password }) => {
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const source = parsed.querySelector("form");
      if (!source) throw new Error("Server-rendered sign-in form missing");
      const form = document.importNode(source, true);
      form.action = "/sign-in";
      form.method = "POST";
      form.hidden = true;
      (form.querySelector("[name=email]") as HTMLInputElement).value =
        "owner@profitplate.test";
      (form.querySelector("[name=password]") as HTMLInputElement).value =
        password;
      document.body.append(form);
      HTMLFormElement.prototype.submit.call(form);
    },
    { html, password },
  );
  const request = await submitted;
  expect((await request.allHeaders()).origin).toBe(expectedOrigin);
  await expect(page).toHaveURL(`/workspace/${org}`);
});

test("native sign-in posts from a different origin remain rejected", async ({
  page,
}) => {
  const target = new URL("/sign-in", "http://127.0.0.1:3100").href;
  const html = await (await page.request.get(target)).text();
  await page.goto("http://127.0.0.1:54329/health");
  const submitted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.request().isNavigationRequest(),
  );
  await page.evaluate(
    ({ html, password, target }) => {
      const source = new DOMParser()
        .parseFromString(html, "text/html")
        .querySelector("form");
      if (!source) throw new Error("Server-rendered sign-in form missing");
      const form = document.importNode(source, true);
      form.action = target;
      form.method = "POST";
      (form.querySelector("[name=email]") as HTMLInputElement).value =
        "owner@profitplate.test";
      (form.querySelector("[name=password]") as HTMLInputElement).value =
        password;
      document.body.append(form);
      HTMLFormElement.prototype.submit.call(form);
    },
    { html, password, target },
  );
  const response = await submitted;
  expect([400, 403, 500]).toContain(response.status());
  await response.finished();
  const probe = await page.context().newPage();
  await probe.goto("http://127.0.0.1:3100/sign-in");
  await expect(probe).toHaveURL("http://127.0.0.1:3100/sign-in");
  await expect(
    probe.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await probe.close();
});

test("development assets allow an owned network address and reject other origins", async ({
  request,
}) => {
  const html = await (await request.get("/sign-in")).text();
  const asset = html.match(/src="([^"]*\/_next\/static\/[^"]+\.js[^"]*)"/)?.[1];
  expect(asset).toBeTruthy();
  const address =
    Object.values(networkInterfaces())
      .flat()
      .find((value) => value?.family === "IPv4" && !value.internal)?.address ||
    "127.0.0.1";
  const localOrigin = `http://${address}:3100`;
  const allowed = await request.get(asset!, {
    headers: { Origin: localOrigin, Referer: `${localOrigin}/sign-in` },
  });
  expect(allowed.status()).toBe(200);
  const blocked = await request.get(asset!, {
    headers: {
      Origin: "http://untrusted.invalid:3100",
      Referer: "http://untrusted.invalid:3100/",
    },
  });
  expect(blocked.status()).toBe(403);
});

test("public auth screens are responsive and have labeled forms", async ({
  page,
}) => {
  await mkdir(".tooling/previews", { recursive: true });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/sign-in");
    await expect(
      page.getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.tooling/previews/sign-in-${width}.png`,
      fullPage: true,
    });
  }
  await page.goto("/sign-up");
  await expect(page.getByLabel("Confirm password")).toBeVisible();
  await page.goto("/forgot-password");
  await expect(
    page.getByRole("button", { name: "Send reset link" }),
  ).toBeVisible();
});

test("protected entry points redirect anonymous users to sign-in", async ({
  page,
}) => {
  for (const path of [
    "/workspace",
    "/setup",
    `/workspace/${org}`,
    `/workspace/${org}/locations`,
    `/workspace/${org}/locations/new`,
    "/update-password",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in$/);
  }
});

test("invalid credentials show a focused error and preserve only the email", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("owner@profitplate.test");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "We could not sign you in",
  );
  await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
  await expect(page.getByLabel("Email address")).toHaveValue(
    "owner@profitplate.test",
  );
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
});

test("a password can be shown without submitting the form", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Password", { exact: true }).fill("a-private-value");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
});

test("unverified identities cannot sign in or reach setup", async ({
  page,
}) => {
  await signIn(page, "unverified@profitplate.test");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Confirm your email",
  );
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("a verified owner resumes the saved workspace and cannot read a foreign tenant", async ({
  page,
  context,
}) => {
  await signIn(page);
  await expect(page).toHaveURL(`/workspace/${org}`);
  await expect(
    page.getByRole("heading", { name: "Welcome to Heritage Kitchen." }),
  ).toBeVisible();
  await expect(page.getByText("1 of 3")).toBeVisible();
  const sessionCookies = (await context.cookies()).filter((cookie) =>
    cookie.name.startsWith("sb-"),
  );
  expect(sessionCookies.length).toBeGreaterThan(0);
  expect(
    sessionCookies.every(
      (cookie) => cookie.httpOnly && cookie.sameSite === "Lax",
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({
    path: ".tooling/previews/workspace-1440.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 960 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByText("Menu", { exact: true }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Workspace" })
      .getByRole("link", { name: "Business settings" }),
  ).toBeVisible();
  await page.getByText("Menu", { exact: true }).click();
  await page.screenshot({
    path: ".tooling/previews/workspace-375.png",
    fullPage: true,
  });
  await page.goto(`/workspace/${otherOrg}`);
  await expect(
    page.getByRole("heading", { name: "Let’s find your workspace." }),
  ).toBeVisible();
  await expect(page.getByText("Another Restaurant")).toHaveCount(0);
  await page.goto(`/workspace/${org}`);
  await page.getByText("Menu", { exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL("/sign-in");
  await page.goto(`/workspace/${org}`);
  await expect(page).toHaveURL("/sign-in");
});

test("new verified users can create a workspace and resume it after reload", async ({
  page,
}) => {
  await signIn(page, "new@profitplate.test");
  await expect(page).toHaveURL("/setup");
  await expect(page.getByText("NGN · Nigerian naira")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({
    path: ".tooling/previews/setup-1440.png",
    fullPage: true,
  });
  await page.getByLabel("Business name").fill("New Test Café");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/workspace\/[a-f0-9-]{36}$/);
  const destination = page.url();
  await expect(
    page.getByRole("heading", { name: "Welcome to New Test Café." }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(destination);
  await page.goto("/setup");
  await expect(page).toHaveURL(destination);
});

test("sign-up confirmation exchanges PKCE only in the requesting browser", async ({
  page,
  request,
  browser,
}) => {
  await page.goto("/sign-up");
  await page.getByLabel("Email address").fill("signup@profitplate.test");
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create your account" }).click();
  await expect(page).toHaveURL("/check-email");
  const { code } = await (
    await request.get(
      "http://127.0.0.1:54329/__test/confirmation?email=signup@profitplate.test",
    )
  ).json();
  expect(code).toBeTruthy();
  const unrelated = await browser.newContext();
  const unrelatedPage = await unrelated.newPage();
  await unrelatedPage.goto(`http://127.0.0.1:3100/auth/callback?code=${code}`);
  await expect(unrelatedPage).toHaveURL(
    "http://127.0.0.1:3100/auth/link-error",
  );
  await unrelated.close();
  await page.goto(`/auth/callback?code=${code}`);
  await expect(page).toHaveURL("/setup");
});

test("password recovery uses a one-time PKCE link and signs out after a password change", async ({
  page,
  request,
}) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email address").fill("owner@profitplate.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");
  const { code } = await (
    await request.get(
      "http://127.0.0.1:54329/__test/confirmation?email=owner@profitplate.test",
    )
  ).json();
  await page.goto(`/auth/callback?code=${code}`);
  await expect(page).toHaveURL("/update-password");
  await page
    .getByLabel("New password", { exact: true })
    .fill("A-new-test-password-2026!");
  await page.getByLabel("Confirm password").fill("A-new-test-password-2026!");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page).toHaveURL("/sign-in?password=updated");
  await page.goto("/setup");
  await expect(page).toHaveURL("/sign-in");
  await page.goto(`/auth/callback?code=${code}`);
  await expect(page).toHaveURL("/auth/link-error");
});

test("suspended membership loses access on the next request with the same cookies", async ({
  page,
  request,
}) => {
  await signIn(page, "staff@profitplate.test");
  await expect(page).toHaveURL(`/workspace/${org}`);
  await request.post("http://127.0.0.1:54329/__test/suspend");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Let’s find your workspace." }),
  ).toBeVisible();
});

test("invalid callback links cannot redirect to an external destination", async ({
  page,
}) => {
  await page.goto("/auth/callback?code=invalid&next=https://evil.example/");
  await expect(page).toHaveURL("/auth/link-error");
  await expect(
    page.getByRole("heading", { name: "Let’s try a fresh link." }),
  ).toBeVisible();
});

test("forged session cookies cannot unlock protected pages", async ({
  page,
  context,
}) => {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const forgedUser = {
    id: "33333333-3333-4333-8333-333333333333",
    email: "owner@profitplate.test",
    email_confirmed_at: new Date().toISOString(),
  };
  const forgedJwt = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: forgedUser.id, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600 })}.${Buffer.alloc(32).toString("base64url")}`;
  await context.addCookies([
    {
      name: "sb-127-auth-token",
      value:
        "base64-" +
        Buffer.from(
          JSON.stringify({
            access_token: forgedJwt,
            refresh_token: "forged",
            expires_at: now + 3600,
            expires_in: 3600,
            token_type: "bearer",
            user: forgedUser,
          }),
        ).toString("base64url"),
      url: "http://127.0.0.1:3100",
    },
  ]);
  await page.goto(`/workspace/${org}`);
  await expect(page).toHaveURL("/sign-in");
});

import { docsOptions, captureSource, translateFixture } from "./docs-language.mjs";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  connectedInteraction,
  docsSession,
  docsTimestamp,
  docsItems,
  mockDocsTerminal,
} from "./docs-fixtures.mjs";

const { origin, output, language } = docsOptions("docs/images/ahub-session-interaction.png");
const directory = await mkdtemp(join(tmpdir(), "ahub-interaction-"));
const browserSession = `interaction-${language}-${Date.now()}`;

async function capture(
  page,
  origin,
  output,
  session,
  interaction,
  timestamp,
  items,
  mockDocsTerminal,
) {
  const resolveMobile = (view) => output.replace(/[^/]+$/, `ahub-mobile-${view}.png`);
  const context = await page
    .context()
    .browser()
    .newContext({
      viewport: { width: 1440, height: 1500 },
      locale: language === "en" ? "en-US" : language,
      timezoneId: "UTC",
      deviceScaleFactor: 1,
      colorScheme: "light",
    });
  await context.addInitScript((value) => {
    if (!localStorage.getItem("ahub.preferences.v1"))
      localStorage.setItem("ahub.preferences.v1", JSON.stringify({ language: value }));
  }, language);
  const demo = await context.newPage();
  const previewToggle = demo.getByRole("button", { name: label("Terminal"), exact: true });
  const composerToggle = demo.getByRole("button", { name: label("Message Input"), exact: true });
  const openComposer = async () => {
    await composerToggle.waitFor();
    if ((await composerToggle.getAttribute("aria-expanded")) !== "true")
      await composerToggle.click();
  };
  const settle = () =>
    demo.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );

  await demo.route("**/api/v1/capabilities", (route) => route.fulfill({ json: { hosting: true } }));
  const verifyPageJumps = async () => {
    await settle();
    const valid = await demo.evaluate(() => {
      const controls = document.querySelector(".page-jump-controls");
      const region = document.querySelector(".message-region");
      return (
        getComputedStyle(controls).position === "absolute" &&
        controls.closest(".message-region") !== null &&
        controls.getBoundingClientRect().bottom <= region.getBoundingClientRect().bottom &&
        controls.getBoundingClientRect().top >= region.getBoundingClientRect().top &&
        document.documentElement.scrollHeight <= innerHeight + 1
      );
    });
    if (!valid)
      throw new Error("Page jumps must stay within the message region without document scrolling");
  };
  const verifyDockBehavior = async () => {
    const composer = demo.getByRole("textbox", { name: label("Message to agent") });
    const draft = await composer.inputValue();
    const attachments = await demo.locator(".interaction-attachment").count();
    await composerToggle.click();
    if (await composer.isVisible()) throw new Error("Collapsed composer is visible");
    if ((await previewToggle.getAttribute("aria-expanded")) !== "true")
      throw new Error("Composer collapse changed preview visibility");
    await composerToggle.click();
    if (
      (await composer.inputValue()) !== draft ||
      (await demo.locator(".interaction-attachment").count()) !== attachments
    )
      throw new Error("Composer collapse lost draft or attachments");
    await demo.getByLabel(label("Terminal content"), { exact: true }).focus();
    await demo.getByRole("button", { name: label("Collapse terminal"), exact: true }).click();
    if (!(await previewToggle.evaluate((element) => document.activeElement === element)))
      throw new Error("Terminal close button lost switch focus");
    await previewToggle.click();
    if (!(await previewToggle.evaluate((element) => document.activeElement === element)))
      throw new Error("Preview expansion stole switch focus");
    // Grow the real message flow to exercise message-region ResizeObserver and page jump geometry.
    await demo.evaluate(() => {
      const spacer = document.createElement("li");
      spacer.id = "scroll-verification";
      spacer.style.height = "1800px";
      document.querySelector(".timeline").append(spacer);
    });
    await settle();
    await demo.evaluate(() => {
      const scroll = document.querySelector(".message-scroll");
      scroll.scrollTo({ top: scroll.scrollHeight, behavior: "instant" });
    });
    await settle();
    await demo.evaluate(() => {
      document.querySelector("#scroll-verification").style.height = "2000px";
    });
    await settle();
    if (
      !(await demo.evaluate(() => {
        const scroll = document.querySelector(".message-scroll");
        return scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 2;
      }))
    )
      throw new Error("New messages did not follow at the end");
    await demo.evaluate(() =>
      document.querySelector(".message-scroll").scrollTo({ top: 600, behavior: "instant" }),
    );
    await settle();
    await demo.evaluate(() => {
      document.querySelector("#scroll-verification").style.height = "2200px";
    });
    await settle();
    if (
      Math.abs(
        (await demo.evaluate(() => document.querySelector(".message-scroll").scrollTop)) - 600,
      ) > 1
    )
      throw new Error("New messages moved the reading position");
    await demo.getByRole("button", { name: label("Jump to bottom"), exact: true }).click();
    await demo.waitForFunction(() => {
      const scroll = document.querySelector(".message-scroll");
      return scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 2;
    });
    const uncovered = await demo.evaluate(
      () =>
        document.querySelector(".terminal-preview").getBoundingClientRect().bottom <=
        document.querySelector(".interaction-region").getBoundingClientRect().top,
    );
    if (!uncovered) throw new Error("Dock covers the terminal at End");
    await demo.getByRole("button", { name: label("Back to top"), exact: true }).click();
    await demo.waitForFunction(() => document.querySelector(".message-scroll").scrollTop < 2);
    await demo.evaluate(() => document.querySelector("#scroll-verification").remove());
    await settle();
  };
  const verifyToolbar = async () => {
    const expanded = await previewToggle.getAttribute("aria-expanded");
    for (const state of ["false", "true"]) {
      if ((await previewToggle.getAttribute("aria-expanded")) !== state)
        await previewToggle.click();
      await demo.locator(".interaction-toolbar .terminal-activity").click();
      if ((await previewToggle.getAttribute("aria-expanded")) !== state)
        throw new Error("Activity status must not toggle terminal preview");
      await settle();
      const fits = await demo.locator(".interaction-toolbar").evaluate((toolbar) => {
        const toggle = toolbar.querySelector(".terminal-preview-toggle");
        const label = toggle.children[1].getBoundingClientRect();
        const activity = toolbar.querySelector(".terminal-activity")?.getBoundingClientRect();
        const bounds = toolbar.getBoundingClientRect();
        return (
          toolbar.scrollWidth <= toolbar.clientWidth &&
          [...toolbar.children].every((element) => {
            const rect = element.getBoundingClientRect();
            return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
          }) &&
          activity !== undefined &&
          Math.abs(label.top + label.height / 2 - activity.top - activity.height / 2) < 2
        );
      });
      if (!fits)
        throw new Error(
          `Terminal toolbar wraps or overflows with expanded=${state} at ${demo.viewportSize().width}px`,
        );
    }
    await demo.keyboard.press("Tab");
    const buttons = demo.locator(
      ".interaction-toolbar button, .interaction-actions button, .terminal-key, .session-title-row button",
    );
    for (const button of await buttons.all()) {
      if (!(await button.isVisible()) || !(await button.isEnabled())) continue;
      await button.focus();
      if (
        !(await button.evaluate((element) => {
          const style = getComputedStyle(element);
          return (
            element.matches(":focus-visible") &&
            parseFloat(style.outlineWidth) === 1 &&
            parseFloat(style.outlineOffset) < 0
          );
        }))
      )
        throw new Error("Session button has an inconsistent outer focus ring");
    }
    if ((await previewToggle.getAttribute("aria-expanded")) !== expanded)
      await previewToggle.click();
  };
  const verifyKeyboardViewport = async () => {
    await demo.evaluate(() => {
      const viewport = window.visualViewport;
      for (const [key, value] of Object.entries({ height: 400, offsetTop: 120 }))
        Object.defineProperty(viewport, key, { configurable: true, value });
      viewport.dispatchEvent(new Event("resize"));
    });
    const verify = async (top) => {
      await settle();
      const aligned = await demo.evaluate((top) => {
        const shell = document.querySelector(".hub").getBoundingClientRect();
        const dock = document.querySelector(".interaction-dock").getBoundingClientRect();
        const messages = document.querySelector(".message-region").getBoundingClientRect();
        return (
          Math.abs(shell.top - top) < 1 &&
          Math.abs(shell.bottom - top - 400) < 1 &&
          Math.abs(dock.bottom - shell.bottom) < 1 &&
          messages.bottom <= dock.top + 1
        );
      }, top);
      if (!aligned) throw new Error("Session shell did not follow the keyboard viewport");
    };
    await verify(120);
    await demo.evaluate(() => {
      Object.defineProperty(window.visualViewport, "offsetTop", { configurable: true, value: 220 });
      window.visualViewport.dispatchEvent(new Event("scroll"));
    });
    await verify(220);
    await demo.evaluate(() => {
      delete window.visualViewport.height;
      delete window.visualViewport.offsetTop;
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    await settle();
    const restored = await demo.locator(".hub").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return Math.abs(rect.top) < 1 && Math.abs(rect.bottom - window.visualViewport.height) < 1;
    });
    if (!restored) throw new Error("Session shell did not recover after the keyboard closed");
  };
  const verifyCompactInteraction = async () => {
    await verifyToolbar();
    const actionSizes = await demo.locator(".interaction-actions").evaluate((element) => {
      const send = element.querySelector(".interaction-send").getBoundingClientRect();
      const attach = element.querySelector(".interaction-attach").getBoundingClientRect();
      return (
        Math.abs(send.height - 36) < 1 &&
        Math.abs(send.top + send.height / 2 - attach.top - attach.height / 2) < 1
      );
    });
    if (!actionSizes)
      throw new Error("Send must be compact and centered beside the attachment button");
    const composer = demo.getByRole("textbox", { name: label("Message to agent") });
    const original = await composer.inputValue();
    await composer.fill("One\nTwo\nThree");
    const metrics = await composer.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        rows: element.rows,
        textHeight:
          element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
        lineHeight: parseFloat(style.lineHeight),
        fits: element.scrollHeight <= element.clientHeight,
        resize: style.resize,
      };
    });
    if (
      metrics.rows !== 3 ||
      Math.abs(metrics.textHeight - 3 * metrics.lineHeight) > 1 ||
      !metrics.fits ||
      metrics.resize !== "vertical"
    )
      throw new Error("Composer must fit three visible text lines and allow vertical resize");
    await composer.fill("One\nTwo\nThree\nFour");
    if (!(await composer.evaluate((element) => element.scrollHeight > element.clientHeight)))
      throw new Error("Fourth composer line must scroll");
    await composer.scrollIntoViewIfNeeded();
    const box = await composer.boundingBox();
    await demo.mouse.move(box.x + box.width - 3, box.y + box.height - 3);
    await demo.mouse.down();
    await demo.mouse.move(box.x + box.width - 3, box.y + box.height + 45, { steps: 5 });
    await demo.mouse.up();
    if ((await composer.boundingBox()).height <= box.height)
      throw new Error("Composer resize handle did not increase height");
    await composer.evaluate((element) => element.style.removeProperty("height"));
    await composer.fill(original);
    if (await demo.locator(".interaction-heading").count())
      throw new Error("Empty interaction heading");
    await demo.getByRole("button", { name: label("Session management"), exact: true }).click();
    const menu = demo.locator(".session-action-menu");
    const labels = await menu.locator("button").allTextContents();
    if (
      labels.join("|") !==
      ["Tmux access", "Archive session", "Delete session", "Exit session"].map(label).join("|")
    )
      throw new Error("Unexpected session menu order");
    const bounds = await menu.boundingBox();
    const viewport = demo.viewportSize();
    if (
      bounds.x < 0 ||
      bounds.x + bounds.width > viewport.width ||
      bounds.y < 0 ||
      bounds.y + bounds.height > viewport.height
    )
      throw new Error("Session menu clipped");
    await demo.getByRole("button", { name: label("Tmux access"), exact: true }).click();
    await demo.getByRole("dialog", { name: label("tmux access"), exact: true }).waitFor();
    await demo.getByRole("button", { name: label("Close tmux access"), exact: true }).click();
  };
  const errors = [];
  demo.on("pageerror", (error) => errors.push(error.message));
  session = { ...session, messageCount: 2 };
  demo.setDefaultTimeout(10000);
  const snapshot = {
    session,
    interaction,
    nextAfter: items.at(-1)?.ordinal ?? 0,
    stateRevision: "demo-revision",
    hasMore: false,
  };
  const sentMessages = [];
  let rejectNextMessage = false;
  const uploadedNames = [];
  let historyDeleted = false;
  let deletionAttempts = 0;
  let thumbnailMissing = false;
  let thumbnailRequests = 0;
  const historyAttachment = {
    id: "docs-upload-1",
    sessionId: session.id,
    filename: "dashboard.png",
    size: 68,
    type: "image/png",
    uploadedAt: timestamp,
    path: "/tmp/camera uploads/photo.png",
  };
  let imageBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
    "base64",
  );
  // A valid 1×1, 24-bit BMP keeps the original-preview check independent of Sharp.
  const bmpBuffer = Buffer.from(
    "Qk06AAAAAAAAADYAAAAoAAAAAQAAAAEAAAABABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AA==",
    "base64",
  );
  await context.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/uploads/docs-upload-1/thumbnail")) {
      thumbnailRequests += 1;
      if (thumbnailMissing) return route.fulfill({ status: 404 });
      return route.fulfill({ contentType: "image/png", body: imageBuffer });
    }
    if (path.endsWith("/uploads/docs-upload-1/content"))
      return route.fulfill({
        contentType: historyAttachment.type,
        body: historyAttachment.type === "image/bmp" ? bmpBuffer : imageBuffer,
      });
    if (path.endsWith("/uploads/docs-upload-1") && route.request().method() === "DELETE") {
      if (++deletionAttempts === 1)
        return route.fulfill({
          status: 500,
          json: { error: { message: "Deletion failed; retry" } },
        });
      historyDeleted = true;
      return route.fulfill({ json: { deleted: true } });
    }
    if (path.endsWith("/uploads") && route.request().method() === "GET")
      return route.fulfill({
        json: { items: historyDeleted ? [] : [historyAttachment] },
      });
    if (path === "/api/v1/uploads" && route.request().method() === "POST") {
      uploadedNames.push(url.searchParams.get("filename"));
      return route.fulfill({
        json: historyAttachment,
      });
    }
    if (path.endsWith("/messages") && route.request().method() === "POST") {
      if (rejectNextMessage) {
        rejectNextMessage = false;
        return route.fulfill({
          status: 409,
          json: {
            error: { code: "message_not_submitted", message: "Untranslated server diagnostic" },
          },
        });
      }
      sentMessages.push(route.request().postDataJSON().message);
      return route.fulfill({ status: 204 });
    }
    if (route.request().method() !== "GET") return route.abort();
    if (
      url.searchParams.get("wait") === "true" ||
      (path === "/api/v1/sessions" && url.searchParams.has("after"))
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/v1/sessions") {
      return route.fulfill({
        json: {
          revision: "demo-catalog",
          agents: [{ nickname: "default", runtimeName: "Codex" }],
          projects: [
            { directory: session.projectDirectory },
            { directory: "/projects/harbor-api" },
            { directory: "/projects/field-notes" },
          ],
          sessions: [
            {
              ...session,
              agent: "default",
              projectDirectory: session.projectDirectory,
              isChild: false,
            },
            ...[
              ["docs-demo-session-keyboard", "Add keyboard navigation", session.projectDirectory],
              ["release", "Review the release checklist", "/projects/harbor-api"],
              ["api", "Document the API endpoints", "/projects/harbor-api"],
              ["guide", "Outline the getting started guide", "/projects/field-notes"],
            ].map(([id, title, projectDirectory]) => ({
              ...session,
              id,
              title,
              projectDirectory,
              agent: "default",
              isChild: false,
              status: "normal",
            })),
          ],
        },
      });
    }
    if (path.endsWith("/messages")) {
      return route.fulfill({
        json: {
          ...snapshot,
          session: path.includes("/docs-demo-session-keyboard/")
            ? { ...session, id: "docs-demo-session-keyboard", title: "Add keyboard navigation" }
            : session,
          items,
        },
      });
    }
    if (path === "/api/v1/sessions/docs-demo-session-keyboard") {
      return route.fulfill({
        json: {
          ...snapshot,
          session: {
            ...session,
            id: "docs-demo-session-keyboard",
            title: "Add keyboard navigation",
          },
        },
      });
    }
    if (path === "/api/v1/sessions/docs-demo-session-00000001") {
      return route.fulfill({ json: snapshot });
    }
    return route.abort();
  });
  async function prepareDesktopPreview() {
    await openComposer();
    if ((await previewToggle.getAttribute("aria-expanded")) !== "true") await previewToggle.click();
    await demo.getByLabel(label("Terminal content"), { exact: true }).waitFor();
    const composer = demo.getByRole("textbox", { name: label("Message to agent") });
    await composer.fill("Suggest the next step.");
    await composer.press("Escape");
    if (
      (await previewToggle.getAttribute("aria-expanded")) !== "true" ||
      !(await composer.evaluate((element) => document.activeElement === element)) ||
      (await composer.inputValue()) !== "Suggest the next step."
    )
      throw new Error("Composer Escape must preserve preview, draft and focus");
    await demo.getByLabel(label("Terminal content"), { exact: true }).waitFor();
    await demo.evaluate(() => document.fonts.ready);
  }

  async function verifyAttachments() {
    const trigger = demo.getByRole("button", { name: label("Attach files"), exact: true });
    const composer = demo.getByRole("textbox", { name: label("Message to agent") });
    await trigger.click();
    const menu = demo.getByRole("menu", { name: label("Attach files") });
    const bounds = await menu.boundingBox();
    const viewport = demo.viewportSize();
    if (
      !bounds ||
      bounds.x < 0 ||
      bounds.y < 0 ||
      bounds.x + bounds.width > viewport.width ||
      bounds.y + bounds.height > viewport.height
    )
      throw new Error("Attachment menu exceeds viewport");
    await demo.keyboard.press("Escape");
    await composer.fill("before replace after");
    await composer.evaluate((input) => input.setSelectionRange(7, 14));
    await trigger.click();
    const chooserPromise = demo.waitForEvent("filechooser");
    await demo.getByRole("menuitem", { name: label("Choose images") }).click();
    const chooser = await chooserPromise;
    if (!chooser.isMultiple()) throw new Error("Gallery does not support multiple images");
    await chooser.setFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    const expected = '- "/tmp/camera uploads/photo.png"\n\nbefore replace after';
    try {
      await demo.waitForFunction(
        (value) => document.querySelector("textarea")?.value === value,
        "before replace after",
      );
    } catch {
      throw new Error(
        `Upload insertion at ${viewport.width}px: ${await composer.inputValue()}; alerts: ${await demo.getByRole("alert").allTextContents()}`,
      );
    }
    await demo.waitForFunction(() => document.activeElement === document.querySelector("textarea"));
    const thumbnail = demo.getByRole("button", { name: label("Preview photo.png"), exact: true });
    await thumbnail.click();
    await demo.getByRole("dialog", { name: label("Preview photo.png"), exact: true }).waitFor();
    await demo.keyboard.press("Escape");
    if (!(await thumbnail.evaluate((element) => document.activeElement === element)))
      throw new Error("Image preview did not restore thumbnail focus");
    if (sentMessages.length) throw new Error("Upload sent without user confirmation");
    await demo.waitForFunction(
      () => document.querySelector(".interaction-send")?.getAttribute("aria-disabled") !== "true",
    );
    rejectNextMessage = true;
    await demo.getByRole("button", { name: label("Send"), exact: true }).click();
    const alert = demo.getByRole("alert");
    await alert
      .getByText(label("Could not submit. Please check the terminal."), { exact: true })
      .waitFor();
    if ((await alert.innerText()).includes("Untranslated server diagnostic"))
      throw new Error("Submission failure leaked server diagnostics");
    if ((await composer.inputValue()) !== "before replace after")
      throw new Error("Submission failure lost the draft");
    await demo.getByRole("button", { name: label("Remove photo.png"), exact: true }).waitFor();
    await demo
      .getByRole("button", { name: label("Dismiss interaction error"), exact: true })
      .click();
    const sent = demo.waitForResponse(
      (response) => response.url().endsWith("/messages") && response.request().method() === "POST",
    );
    await demo.getByRole("button", { name: label("Send"), exact: true }).click();
    await sent;
    try {
      await demo.waitForFunction(() => document.querySelector("textarea")?.value === "");
    } catch {
      throw new Error(
        `Send failed at ${viewport.width}px: ${await composer.inputValue()}; sent: ${JSON.stringify(sentMessages)}; alerts: ${await demo.getByRole("alert").allTextContents()}`,
      );
    }
    const sentMessage = sentMessages.pop();
    const uploadedName = uploadedNames.pop();
    if (sentMessage !== expected || uploadedName !== "photo.png")
      throw new Error(
        `Unexpected upload or message payload: ${JSON.stringify({ sentMessage, expected, uploadedName })}`,
      );
    await trigger.click();
    const cameraPromise = demo.waitForEvent("filechooser");
    await demo.getByRole("menuitem", { name: label("Take photo") }).click();
    const camera = await cameraPromise;
    if (camera.isMultiple()) throw new Error("Camera accepts multiple files");
    await camera.setFiles([]);
    if (await composer.inputValue()) throw new Error("Cancelled camera changed the draft");
    for (const kind of ["paste", "drop"]) {
      await composer.evaluate((input, kind) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(["browser upload"], `${kind}.txt`, { type: "text/plain" }));
        const event =
          kind === "paste"
            ? new ClipboardEvent("paste", {
                clipboardData: transfer,
                bubbles: true,
                cancelable: true,
              })
            : new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true });
        input.dispatchEvent(event);
      }, kind);
      const remove = demo.getByRole("button", { name: label(`Remove ${kind}.txt`), exact: true });
      await remove.waitFor();
      await remove.click();
      if (uploadedNames.pop() !== `${kind}.txt`) throw new Error(`Unexpected ${kind} filename`);
    }
    const previewWasExpanded = (await previewToggle.getAttribute("aria-expanded")) === "true";
    await composer.fill("Draft survives switching sessions");
    await demo.evaluate(() => {
      history.pushState(null, "", "/sessions/docs-demo-session-keyboard");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await openComposer();
    await demo.getByRole("textbox", { name: label("Message to agent") }).waitFor();
    if (await composer.inputValue()) throw new Error("Draft leaked into another session");
    await demo.evaluate((id) => {
      history.pushState(null, "", `/sessions/${id}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, session.id);
    await demo.waitForFunction(
      () => document.querySelector("textarea")?.value === "Draft survives switching sessions",
    );
    if (previewWasExpanded) {
      if ((await previewToggle.getAttribute("aria-expanded")) !== "true")
        await previewToggle.click();
      await demo.getByLabel(label("Terminal content"), { exact: true }).waitFor();
    }
    await composer.fill("Suggest the next step.");
  }

  async function stageAttachment() {
    const buffer = await demo.locator(".user-input-card").screenshot();
    imageBuffer = buffer;
    await demo.getByLabel(label("Choose files"), { exact: true }).setInputFiles({
      name: "dashboard.png",
      mimeType: "image/png",
      buffer,
    });
    const image = demo.getByRole("img", { name: label("dashboard.png"), exact: true });
    await image.waitFor();
    await image.evaluate((element) => element.decode());
  }

  async function verifyUnavailableUploadPreviews() {
    const original = { ...historyAttachment };
    try {
      for (const { type, filename, missing, requests } of [
        { type: "image/bmp", filename: "dashboard.bmp", missing: false, requests: 0 },
        { type: "image/png", filename: "dashboard.png", missing: true, requests: 1 },
      ]) {
        Object.assign(historyAttachment, { type, filename });
        thumbnailMissing = missing;
        const requestsBefore = thumbnailRequests;
        await demo.reload();
        await demo.getByText(label("Preview unavailable"), { exact: true }).waitFor();
        if (await demo.locator(".upload-preview img").count())
          throw new Error(`${type} loaded an image instead of the unavailable label`);
        if (thumbnailRequests - requestsBefore !== requests)
          throw new Error(`${type} made unexpected thumbnail requests`);
        await demo.getByRole("button", { name: label(`Expand ${filename}`), exact: true }).click();
        const image = demo.getByRole("img", { name: filename, exact: true });
        await image.evaluate((element) => element.decode());
        if (!(await image.getAttribute("src")).endsWith("/content"))
          throw new Error(`${type} did not expand the original`);
        await demo
          .getByRole("button", { name: label(`Collapse ${filename}`), exact: true })
          .click();
        await demo.getByText(label("Preview unavailable"), { exact: true }).waitFor();
        if (thumbnailRequests - requestsBefore !== requests)
          throw new Error(`${type} retried its unavailable thumbnail on collapse`);
      }
    } finally {
      Object.assign(historyAttachment, original);
      thumbnailMissing = false;
    }
  }

  async function verifyUploadHistory() {
    const composer = demo.getByRole("textbox", { name: label("Message to agent") });
    await composer.fill("Keep this draft while browsing uploads");
    await stageAttachment();
    await demo.getByRole("link", { name: label("Upload history"), exact: true }).click();
    await demo.getByRole("heading", { name: label("Upload history"), exact: true }).waitFor();
    const historyImage = demo.getByRole("img", { name: label("dashboard.png"), exact: true });
    await historyImage.evaluate((element) => element.decode());
    if (!(await historyImage.getAttribute("src")).endsWith("/thumbnail"))
      throw new Error("History did not load the thumbnail");
    await demo.getByRole("button", { name: label("Expand dashboard.png"), exact: true }).click();
    await historyImage.evaluate((element) => element.decode());
    if (!(await historyImage.getAttribute("src")).endsWith("/content"))
      throw new Error("Expansion did not load the original");
    await demo
      .getByRole("button", { name: label("Collapse dashboard.png"), exact: true })
      .waitFor();
    if (await demo.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error("Upload history horizontal overflow");
    if (demo.viewportSize().width > 600) {
      await demo.screenshot({
        path: output.replace(/[^/]+$/, "ahub-uploads.png"),
        animations: "disabled",
      });
    }
    await demo.evaluate(() => {
      window.restoreDownloadNavigator = Object.fromEntries(
        ["userAgent", "standalone", "share", "canShare"].map((key) => [
          key,
          Object.getOwnPropertyDescriptor(navigator, key),
        ]),
      );
      Object.defineProperties(navigator, {
        userAgent: { configurable: true, value: "iPhone" },
        standalone: { configurable: true, value: true },
        canShare: { configurable: true, value: () => true },
        share: {
          configurable: true,
          value: async ({ files }) => {
            if (files[0].name !== "dashboard.png" || files[0].type !== "image/png")
              throw new Error("Incorrect shared file metadata");
            window.sharedDownloadFile = true;
          },
        },
      });
    });
    // Re-render with standalone detection, then exercise both explicit user gestures.
    await demo.getByRole("button", { name: label("Collapse dashboard.png"), exact: true }).click();
    const historyUrl = demo.url();
    await demo.getByRole("button", { name: label("Download"), exact: true }).click();
    await demo.getByRole("button", { name: label("Save file"), exact: true }).click();
    await demo.getByRole("button", { name: label("Download"), exact: true }).waitFor();
    if (demo.url() !== historyUrl || !(await demo.evaluate(() => window.sharedDownloadFile)))
      throw new Error("Standalone download navigated away or failed to share");
    await demo.evaluate(() => {
      for (const [key, descriptor] of Object.entries(window.restoreDownloadNavigator)) {
        if (descriptor) Object.defineProperty(navigator, key, descriptor);
        else delete navigator[key];
      }
      delete window.restoreDownloadNavigator;
      delete window.sharedDownloadFile;
    });
    await demo.goBack();
    await composer.waitFor();
    if ((await composer.inputValue()) !== "Keep this draft while browsing uploads")
      throw new Error("History lost draft text");
    await demo.getByRole("button", { name: label("Remove dashboard.png"), exact: true }).waitFor();
    await demo.goForward();
    await demo.getByRole("heading", { name: label("Upload history"), exact: true }).waitFor();
    await verifyUnavailableUploadPreviews();
    await demo.reload();
    await demo.getByRole("button", { name: label("Delete"), exact: true }).click();
    await demo.getByRole("button", { name: label("Cancel"), exact: true }).click();
    await demo.getByRole("button", { name: label("Delete"), exact: true }).click();
    await demo.getByRole("button", { name: label("Confirm delete"), exact: true }).click();
    await demo.getByRole("alert").waitFor();
    await demo.getByRole("button", { name: label("Confirm delete"), exact: true }).click();
    await demo.getByText(label("No uploads yet."), { exact: true }).waitFor();
    await demo.getByRole("link", { name: label("← Back to session"), exact: true }).click();
    await openComposer();
    await composer.waitFor();
    historyDeleted = false;
    await prepareDesktopPreview();
  }

  async function verifySidebarCollapse() {
    // Collapsing must reclaim the sidebar width without remounting the composer.
    const sidebarToggle = demo.locator(".hub-sidebar-toggle:visible");
    const draftBeforeCollapse = demo.locator("textarea");
    await draftBeforeCollapse.fill("Sidebar toggle keeps this draft");
    const originalComposer = await draftBeforeCollapse.elementHandle();
    for (const width of [1440, 1024, 768]) {
      await demo.setViewportSize({ width, height: 1500 });
      const expandedWidth = await demo.locator(".hub-content").evaluate((el) => el.clientWidth);
      await sidebarToggle.click();
      if (await demo.locator(".hub-sidebar").isVisible())
        throw new Error("Collapsed sidebar remains visible");
      const collapsedWidth = await demo.locator(".hub-content").evaluate((el) => el.clientWidth);
      if (collapsedWidth - expandedWidth !== 302)
        throw new Error("Collapsing did not reclaim sidebar width");
      await sidebarToggle.click();
      if (!(await demo.locator(".hub-sidebar").isVisible()))
        throw new Error("Sidebar did not expand");
    }
    if (
      !(await draftBeforeCollapse.evaluate((el, original) => el === original, originalComposer)) ||
      (await draftBeforeCollapse.inputValue()) !== "Sidebar toggle keeps this draft"
    )
      throw new Error("Sidebar toggle remounted or cleared the composer");
    await sidebarToggle.click();
    await demo.reload();
    await sidebarToggle.waitFor();
    if ((await sidebarToggle.getAttribute("aria-expanded")) !== "false")
      throw new Error("Sidebar collapse was not restored after reload");
    await demo.setViewportSize({ width: 390, height: 844 });
    await demo.goto(origin);
    if (!(await demo.locator(".hub-sidebar").isVisible()))
      throw new Error("Desktop collapse hid the mobile catalog");
    await demo.goto(`${origin}/sessions/${session.id}`);
    await demo.setViewportSize({ width: 1440, height: 1500 });
    await sidebarToggle.click();
  }

  async function assertDesktopCardsVisible() {
    for (const selector of [".user-input-card", ".interaction-region"]) {
      const bounds = await demo.locator(selector).boundingBox();
      if (!bounds || bounds.y < 0 || bounds.y + bounds.height > 1500)
        throw new Error(`${selector} is clipped`);
    }
  }

  async function verifyComposerPersistence() {
    const input = demo.getByRole("textbox", { name: label("Message to agent") });
    await input.fill("Draft stays in memory across composer toggles");
    await composerToggle.click();
    await demo.reload();
    await composerToggle.waitFor();
    if ((await composerToggle.getAttribute("aria-expanded")) !== "false")
      throw new Error("Composer collapse was not restored after reload");
    await composerToggle.click();
    if (await input.inputValue()) throw new Error("Draft text was persisted across reload");
    await demo.reload();
    await composerToggle.waitFor();
    if ((await composerToggle.getAttribute("aria-expanded")) !== "true")
      throw new Error("Composer expansion was not restored after reload");
  }

  await mockDocsTerminal(context, timestamp);
  try {
    await demo.goto(`${origin}/sessions/${session.id}`);
    await prepareDesktopPreview();
    await verifyComposerPersistence();
    await prepareDesktopPreview();
    const selectedProject = demo.getByRole("button", {
      name: new RegExp(
        label("{{project}}, {{count, number}} main sessions", {
          project: "atlas-dashboard",
          count: ".*",
        }),
      ),
    });
    await selectedProject.waitFor();
    if ((await selectedProject.getAttribute("aria-expanded")) !== "true")
      throw new Error("Opening a session must expand its project");
    await verifySidebarCollapse();
    await prepareDesktopPreview();
    await verifyCompactInteraction();
    await verifyAttachments();
    await prepareDesktopPreview();
    for (const name of ["Message to agent", "Terminal content"]) {
      if (!(await demo.getByLabel(label(name), { exact: true }).isVisible()))
        throw new Error(`${name} is hidden`);
    }
    if (!(await demo.getByRole("button", { name: label("Handoff"), exact: true }).isVisible()))
      throw new Error("Handoff is hidden");
    if (errors.length) throw new Error(errors.join("\n"));
    if (await demo.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error("Horizontal overflow");
    await demo.locator(".user-input-status.answered").waitFor();
    await demo
      .getByText(label("Project health selected. Ready for the next step."), { exact: false })
      .waitFor();
    if (await demo.getByRole("alert").count()) throw new Error("Desktop error alert");
    await verifyUploadHistory();
    await stageAttachment();
    await verifyDockBehavior();
    await demo.evaluate(() => document.querySelector(".message-scroll").scrollTo(0, 0));
    await assertDesktopCardsVisible();
    await demo.screenshot({
      path: output,
      animations: "disabled",
    });
    await demo.getByRole("button", { name: label("Settings"), exact: true }).click();
    const enterToSend = demo.getByRole("checkbox", {
      name: label("Enter to send (Shift+Enter for newline)"),
      exact: true,
    });
    await enterToSend.check();
    await demo.getByRole("button", { name: label("Close settings"), exact: true }).click();
    await demo.reload();
    const shortcutComposer = demo.getByRole("textbox", { name: label("Message to agent") });
    await openComposer();
    await shortcutComposer.waitFor();
    if (
      !(await shortcutComposer.getAttribute("placeholder")).includes(
        label("Shift+Enter for newline"),
      )
    )
      throw new Error("Send shortcut was not restored after reload");
    await shortcutComposer.fill("/help");
    await shortcutComposer.press("Shift+Enter");
    if ((await shortcutComposer.inputValue()) !== "/help\n")
      throw new Error("Shift+Enter did not insert a newline");
    await shortcutComposer.fill("");
    await demo.getByRole("button", { name: label("Settings"), exact: true }).click();
    await enterToSend.uncheck();
    await demo.getByRole("button", { name: label("Close settings"), exact: true }).click();
    // Exercise mobile entry defaults without the desktop's explicit composer choice.
    await demo.evaluate((id) => {
      const key = "ahub.browser-state.v1";
      const state = JSON.parse(sessionStorage.getItem(key) ?? "{}");
      delete state[`ahub.composer-expanded.${id}`];
      sessionStorage.setItem(key, JSON.stringify(state));
    }, session.id);
    await demo.setViewportSize({ width: 390, height: 844 });
    await demo.goto(origin);
    for (const project of ["atlas-dashboard", "harbor-api", "field-notes"]) {
      const toggle = demo.getByRole("button", {
        name: new RegExp(
          label("{{project}}, {{count, number}} main sessions", { project, count: ".*" }),
        ),
      });
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    }
    await demo.getByText(session.title, { exact: true }).waitFor();
    if (await demo.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error("Catalog horizontal overflow");
    await demo.evaluate(() => document.fonts.ready);
    await demo.screenshot({ path: resolveMobile("catalog"), animations: "disabled" });
    await demo.getByText(session.title, { exact: true }).click();
    await demo.locator(".user-input-status.answered").waitFor();
    await demo
      .locator(".user-input-card")
      .evaluate((card) => card.scrollIntoView({ block: "center" }));
    if (await demo.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error("Mobile horizontal overflow");
    if (errors.length || (await demo.getByRole("alert").count()))
      throw new Error(errors.join("\n") || "Mobile error alert");
    if ((await composerToggle.getAttribute("aria-expanded")) !== "false")
      throw new Error("Long conversations should start with the composer collapsed");
    await demo.evaluate(() => {
      const scroll = document.querySelector(".message-scroll");
      scroll.scrollTo({ top: scroll.scrollHeight, behavior: "instant" });
    });
    await settle();
    if ((await composerToggle.getAttribute("aria-expanded")) !== "false")
      throw new Error("Scrolling to the end must not expand the composer");
    await demo
      .locator(".user-input-card")
      .evaluate((card) => card.scrollIntoView({ block: "center" }));
    await demo.screenshot({ path: resolveMobile("reader"), animations: "disabled" });
    await openComposer();
    await previewToggle.click();
    const composer = demo.getByRole("textbox", { name: label("Message to agent") });
    await verifyCompactInteraction();
    await composer.fill("Suggest the next step.");
    await stageAttachment();
    await settle();
    await demo
      .locator(".interaction-region")
      .evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
    const panelBounds = await demo.locator(".interaction-region").boundingBox();
    if (panelBounds.y < 0 || panelBounds.y + panelBounds.height > 845)
      throw new Error(`Mobile attachment composer is clipped: ${JSON.stringify(panelBounds)}`);
    await verifyPageJumps();
    await demo.screenshot({ path: resolveMobile("composer"), animations: "disabled" });
    await demo.getByRole("button", { name: label("Remove dashboard.png"), exact: true }).click();
    await verifyAttachments();
    await demo.setViewportSize({ width: 320, height: 568 });
    await verifyCompactInteraction();
    deletionAttempts = 0;
    await verifyUploadHistory();
    await verifyAttachments();
    await verifyPageJumps();
    if (await demo.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error("Narrow composer horizontal overflow");
    await demo.setViewportSize({ width: 390, height: 844 });
    await verifyKeyboardViewport();
    await demo.setViewportSize({ width: 390, height: 400 });
    await verifyPageJumps();
    await composer.blur();
    await verifyPageJumps();
    await composer.focus();
    await demo.setViewportSize({ width: 1440, height: 1000 });
    await verifyPageJumps();
    await previewToggle.click();
    await verifyPageJumps();
    await demo.setViewportSize({ width: 1440, height: 400 });
    await demo.evaluate(() => document.querySelector(".message-scroll").scrollTo(0, 0));
    await verifyPageJumps();
    items = [1, 2].map((ordinal) => ({
      kind: "message",
      id: `plan-${ordinal}`,
      ordinal,
      timestamp,
      role: "assistant",
      phase: "response",
      itemType: "plan",
      markdown: `# Plan ${ordinal}`,
    }));
    await demo.reload();
    const plans = demo.locator(".plan-toggle");
    await plans.nth(1).waitFor();
    if (
      (await plans.nth(0).getAttribute("aria-expanded")) !== "false" ||
      (await plans.nth(1).getAttribute("aria-expanded")) !== "true"
    )
      throw new Error("Latest plan must be the only plan initially expanded");
    await demo.getByRole("heading", { name: label("Plan 2"), exact: true }).waitFor();
    await plans.nth(0).click();
    await demo.getByRole("heading", { name: label("Plan 1"), exact: true }).waitFor();
    if ((await plans.nth(1).getAttribute("aria-expanded")) !== "true")
      throw new Error("Manually opening an older plan closed the latest plan");
    await plans.nth(1).click();
    if ((await plans.nth(1).getAttribute("aria-expanded")) !== "false")
      throw new Error("Latest plan cannot be manually hidden");
    // Exercise the actual setting, rather than only seeding localized screenshots.
    const draft = demo.locator("textarea");
    await openComposer();
    await draft.fill("Preserve this draft /original/path");
    const originalInput = await draft.elementHandle();
    const nextLanguage = language === "en" ? "zh-CN" : "en";
    await demo.getByRole("button", { name: label("Settings"), exact: true }).click();
    await demo
      .getByRole("combobox", {
        name: label("Language"),
        exact: true,
      })
      .selectOption(nextLanguage);
    await demo.waitForFunction((value) => document.documentElement.lang === value, nextLanguage);
    await demo
      .getByRole("button", {
        name: nextLanguage === "en" ? "Close settings" : "关闭设置",
        exact: true,
      })
      .click();
    await demo
      .getByRole("textbox", {
        name: nextLanguage === "en" ? "Message to agent" : "发送给智能体的消息",
        exact: true,
      })
      .waitFor();
    if (
      !(await draft.evaluate((element, original) => element === original, originalInput)) ||
      (await draft.inputValue()) !== "Preserve this draft /original/path"
    )
      throw new Error("Language switching remounted or cleared the draft");
    await demo.reload();
    await demo.waitForFunction((value) => document.documentElement.lang === value, nextLanguage);
    const otherTab = await context.newPage();
    await otherTab.goto(origin);
    await otherTab.waitForFunction(
      (value) => document.documentElement.lang === value,
      nextLanguage,
    );
    await otherTab.evaluate((value) => {
      const settings = JSON.parse(localStorage.getItem("ahub.preferences.v1"));
      localStorage.setItem("ahub.preferences.v1", JSON.stringify({ ...settings, language: value }));
    }, language);
    await demo.waitForFunction((value) => document.documentElement.lang === value, language);
    await otherTab.close();
    // Verify exit, native deletion, and confirmation phases in the session view.
    await demo.goto(origin + "/sessions/" + session.id);
    let deletePhase = "sending_exit";
    const deletion = () => ({
      operationId: "docs-delete-exit",
      type: "delete",
      sessionId: session.id,
      status: "pending",
      phase: deletePhase,
      error: null,
      attachCommand: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await demo.route("**/api/v1/sessions/" + session.id, (route) =>
      route.request().method() === "DELETE"
        ? route.fulfill({ status: 202, json: deletion() })
        : route.fallback(),
    );
    await demo.route("**/api/v1/operations/docs-delete-exit", (route) =>
      route.fulfill({ json: deletion() }),
    );
    await demo.getByRole("button", { name: label("Session management"), exact: true }).click();
    await demo.getByRole("button", { name: label("Delete session"), exact: true }).click();
    await demo.getByRole("button", { name: label("Confirm delete"), exact: true }).click();
    await demo.getByText(label("Sending exit command"), { exact: true }).waitFor();
    deletePhase = "waiting_exit";
    await demo.getByText(label("Waiting for exit"), { exact: true }).waitFor();
    deletePhase = "deleting";
    await demo.getByText(label("Deleting history"), { exact: true }).waitFor();
    deletePhase = "confirming_delete";
    await demo.getByText(label("Confirming deletion"), { exact: true }).waitFor();
    if (errors.length) throw new Error(errors.join("\n"));
  } catch (error) {
    await demo.screenshot({ path: "/tmp/ahub-capture-failure.png" });
    throw new Error(
      `${error.message}\nPage: ${demo.url()}\n${await demo.locator("body").innerText()}\n${errors.join("\n")}`,
    );
  } finally {
    await context.close();
  }
}

const recording = join(directory, "capture.js");
await writeFile(
  recording,
  `(page) => (${captureSource(capture, language)})(page, ${[origin, output, translateFixture(docsSession, language), connectedInteraction, docsTimestamp, translateFixture(docsItems, language)].map((value) => JSON.stringify(value)).join(", ")}, ${mockDocsTerminal.toString()})`,
);
const cli = (...args) =>
  execFileSync("playwright-cli", [`-s=${browserSession}`, ...args], { stdio: "inherit" });
try {
  cli("open", "about:blank");
  cli("run-code", "--filename", recording);
} finally {
  cli("close");
}
console.log(`Saved ${output}`);

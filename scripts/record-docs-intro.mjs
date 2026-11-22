import { docsOptions, captureSource, docsLogLink, translateFixture } from "./docs-language.mjs";
import {
  connectedInteraction,
  docsSession,
  docsTimestamp,
  docsUserInput,
  mockDocsTerminal,
} from "./docs-fixtures.mjs";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Requires a running client server, playwright-cli, and Python with Pillow.
const { origin, output, language } = docsOptions("docs/images/ahub-intro.gif");
const frames = await mkdtemp(join(tmpdir(), "ahub-intro-"));
const browserSession = `intro-${language}-${Date.now()}`;

async function record(
  page,
  frames,
  origin,
  docsSession,
  connectedInteraction,
  timestamp,
  docsUserInput,
  previewLogLink,
  mockDocsTerminal,
) {
  const context = await page
    .context()
    .browser()
    .newContext({
      viewport: { width: 1280, height: 1100 },
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
  // Serve the real client in Hub mode even when recording against Vite.
  await context.route(/^https?:\/\/[^/]+\/(?:nodes\/mac\/sessions\/[^/]+)?$/, async (route) => {
    if (!route.request().isNavigationRequest()) return route.fallback();
    const response = await route.fetch({ url: new URL("/", origin).href });
    const html = await response.text();
    return route.fulfill({
      response,
      body: html.includes('name="ahub-multi-node"')
        ? html
        : html.replace("</head>", '<meta name="ahub-multi-node"></head>'),
    });
  });
  demo.setDefaultTimeout(10000);
  const errors = [];
  demo.on("pageerror", (error) => errors.push(error.message));
  const prompt = label("Suggest three improvements for this project dashboard.");
  const reply = label(
    "### Three focused improvements\n\n1. **Show project health.** Put status and open tasks at the top.\n2. **Highlight recent activity.** Surface the latest changes and decisions.\n3. **Keep navigation clear.** Group sessions by project for quick access.",
  );
  const macProject = "/projects/atlas-dashboard";
  const linuxProject = "/srv/projects/relay-service";
  const newSessionId = "docs-demo-intro-session-000001";
  const newSessionPath = `/nodes/mac/sessions/${newSessionId}`;
  const linuxTitle = label("Review relay deployment");
  const linuxReply = label("The relay is ready for a staging deployment.");
  const resumableSession = {
    ...docsSession,
    status: "normal",
    resume: { allowed: true, reason: null },
    agent: "default",
  };
  const linuxSession = {
    ...resumableSession,
    id: "docs-demo-linux-session-000001",
    sourceId: "00000000-0000-4000-8000-000000000002",
    title: linuxTitle,
    workingDirectory: linuxProject,
    projectDirectory: linuxProject,
    messageCount: 1,
  };
  let sentMessages = 0;
  let created = false;
  let stage = 0;
  let resumable = false;
  const session = () => ({
    ...docsSession,
    id: newSessionId,
    sourceId: "00000000-0000-4000-8000-000000000003",
    title: label("Improve the project dashboard"),
    messageCount: stage,
    ...(resumable ? { status: "normal", resume: { allowed: true, reason: null } } : {}),
  });
  const interaction = connectedInteraction;
  const items = () =>
    [
      {
        id: "prompt",
        ordinal: 1,
        timestamp,
        kind: "message",
        role: "user",
        phase: null,
        itemType: null,
        markdown: prompt,
      },
      {
        id: "reply",
        ordinal: 4,
        timestamp,
        kind: "message",
        role: "assistant",
        phase: "response",
        itemType: null,
        markdown: `${reply}\n\n${previewLogLink}`,
      },
    ]
      .slice(0, stage)
      .flatMap((item) =>
        item.id === "reply"
          ? [
              ...docsUserInput.map((question) => ({ ...question, ordinal: question.ordinal + 1 })),
              item,
            ]
          : [item],
      );
  const snapshot = () => ({
    session: session(),
    interaction: resumable ? { ...interaction, state: "disconnected" } : interaction,
    nextAfter: items().at(-1)?.ordinal ?? 0,
    stateRevision: String(stage),
    hasMore: false,
  });
  const newSessionMessages = `/sessions/${newSessionId}/messages`;
  await context.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const url = new URL(route.request().url());
    const json = (body) => route.fulfill({ json: body });
    if (url.pathname === "/api/nodes") return json({ nodes: [{ id: "mac" }, { id: "linux" }] });
    const [, node, path] = /^\/api\/nodes\/(mac|linux)\/v1(\/.*)$/.exec(url.pathname) ?? [];
    const method = route.request().method();
    if (path === "/capabilities") return json({ hosting: true });
    if (node === "linux" && method === "GET") {
      if (path === "/sessions")
        return json({
          revision: "1",
          agents: [{ nickname: "default", runtimeName: "Codex" }],
          projects: [{ directory: linuxProject }],
          sessions: [linuxSession],
        });
      if (path === `/sessions/${linuxSession.id}/messages`) {
        if (url.searchParams.get("stateRevision") === "1") {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return route.fulfill({ status: 204 });
        }
        return json({
          session: linuxSession,
          interaction: {
            ...interaction,
            state: "disconnected",
            activity: null,
            attachCommand: null,
          },
          nextAfter: 1,
          stateRevision: "1",
          hasMore: false,
          items: [
            {
              id: "relay-reply",
              ordinal: 1,
              timestamp,
              kind: "message",
              role: "assistant",
              phase: "response",
              itemType: null,
              markdown: linuxReply,
            },
          ],
        });
      }
    }
    if (node !== "mac") throw new Error(`Unexpected demo API: ${method} ${url.pathname}`);
    if (path === "/sessions") {
      if (method === "POST") {
        const body = route.request().postDataJSON();
        if (body.agent !== "default" || body.projectDirectory !== macProject || body.worktree) {
          throw new Error("Unexpected create request");
        }
        created = true;
        return json({
          operationId: "demo-create",
          type: "create",
          status: "succeeded",
          sessionId: newSessionId,
          phase: null,
          attachCommand: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          error: null,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      return json({
        revision: String(created),
        agents: [
          { nickname: "default", runtimeName: "Codex" },
          { nickname: "work", runtimeName: "Claude Code" },
        ],
        projects: [{ directory: macProject }],
        sessions: created
          ? [{ ...session(), agent: "default" }, resumableSession]
          : [resumableSession],
      });
    }
    if (path === newSessionMessages && method === "GET") {
      if (url.searchParams.get("wait") === "true")
        await new Promise((resolve) => setTimeout(resolve, 200));
      if (url.searchParams.get("stateRevision") === String(stage))
        return route.fulfill({ status: 204 });
      return json({
        ...snapshot(),
        items: items().filter((item) => item.ordinal > Number(url.searchParams.get("after") ?? 0)),
      });
    }
    if (path === newSessionMessages && method === "POST") {
      if (route.request().postDataJSON().message !== prompt) throw new Error("Unexpected prompt");
      sentMessages += 1;
      return route.fulfill({ status: 204 });
    }
    throw new Error(`Unexpected demo API: ${method} ${url.pathname}`);
  });
  await mockDocsTerminal(context, timestamp, "/api/nodes/mac/v1");
  let frame = 0;
  const capture = async (duration) => {
    await demo.evaluate(() => document.fonts.ready);
    await demo.screenshot({
      path: `${frames}/${String(frame++).padStart(3, "0")}-${duration}.png`,
    });
  };
  try {
    await demo.goto(origin);
    const nodeTab = (id) =>
      demo.locator(".hub-node-tabs").getByRole("link", { name: id, exact: true });
    const project = (directory) => demo.locator(`.hub-project[data-project="${directory}"]`);
    const checkNode = async (id, path, directory) => {
      await demo.waitForURL(new URL(path, origin).href);
      await nodeTab(id).and(demo.locator('[aria-current="page"]')).waitFor();
      await project(directory).waitFor();
      const visible = await demo
        .locator(".hub-project")
        .evaluateAll((projects) => projects.map((entry) => entry.getAttribute("data-project")));
      if (visible.length !== 1 || visible[0] !== directory)
        throw new Error(`Unexpected project list on ${id}: ${visible.join(", ")}`);
    };
    await checkNode("mac", "/nodes/mac/", macProject);
    await capture(1300);
    await nodeTab("linux").click();
    await checkNode("linux", "/nodes/linux/", linuxProject);
    const linuxSessionLink = project(linuxProject).getByRole("link", { name: linuxTitle });
    const linuxProjectToggle = project(linuxProject).locator("button[aria-expanded]");
    if ((await linuxProjectToggle.getAttribute("aria-expanded")) === "false")
      await linuxProjectToggle.click();
    await linuxSessionLink.click();
    await checkNode("linux", `/nodes/linux/sessions/${linuxSession.id}`, linuxProject);
    await demo.getByText(linuxReply, { exact: true }).waitFor();
    await capture(2100);
    await nodeTab("mac").click();
    await checkNode("mac", "/nodes/mac/", macProject);
    await capture(1000);
    const createTrigger = demo
      .getByRole("button", { name: label("New session"), exact: true })
      .first();
    await createTrigger.press("Enter");
    await demo.waitForFunction(
      () => document.querySelector("select[required]")?.value === "default",
    );
    const permissionSelect = demo.getByRole("combobox", {
      name: label("Permission mode"),
      exact: true,
    });
    if ((await permissionSelect.inputValue()) !== "default")
      throw new Error("Default permission mode changed");
    for (const mode of ["auto", "yolo", "default"]) {
      await permissionSelect.selectOption(mode);
      if ((await permissionSelect.inputValue()) !== mode)
        throw new Error("Permission selection failed");
    }
    const agentSelect = demo.getByRole("combobox", { name: label("Session agent") });
    if ((await agentSelect.locator('option[value="work"]').textContent()) !== "work · Claude Code")
      throw new Error("Agent options must include the runtime name");
    await capture(900);
    const directory = demo.getByRole("combobox", { name: label("Project directory") });
    await directory.selectOption(macProject);
    await capture(1100);
    await createTrigger.evaluate((button) => {
      button.addEventListener("focus", () => button.setAttribute("data-focus-restored", ""), {
        once: true,
      });
    });
    await demo.getByRole("button", { name: label("Create session"), exact: true }).press("Enter");
    const composer = demo.getByRole("textbox", { name: label("Message to agent") });
    await composer.waitFor();
    await checkNode("mac", newSessionPath, macProject);
    if (!created) throw new Error("No session was created on mac");
    if ((await createTrigger.getAttribute("data-focus-restored")) === null)
      throw new Error("Creating a session did not restore focus to the dialog trigger");
    await demo.waitForFunction(
      () =>
        document
          .querySelector(
            '.hub-project[data-project="/projects/atlas-dashboard"] button[aria-expanded]',
          )
          ?.getAttribute("aria-expanded") === "true",
    );
    await capture(1200);
    await composer.click();
    for (const character of prompt) {
      await composer.pressSequentially(character);
      await capture(60);
    }
    await capture(1000);
    if (await demo.getByText(label("Three focused improvements"), { exact: true }).count()) {
      throw new Error("Reply appeared before send");
    }
    await demo.getByRole("button", { name: label("Send"), exact: true }).click();
    await demo.waitForFunction(() => document.querySelector("textarea")?.value === "");
    if (sentMessages !== 1) throw new Error("Expected one message sent to mac");
    await demo.locator(".message-preview").waitFor();
    await capture(900);
    stage = 1;
    await demo.locator(".message-preview").waitFor({ state: "hidden" });
    await demo.getByText(prompt, { exact: true }).waitFor();
    await capture(1100);
    stage = 2;
    await demo.getByRole("heading", { name: label("Three focused improvements") }).waitFor();
    await demo.locator(".user-input-status.answered").waitFor();
    await demo.locator('.composer-toggle[aria-expanded="true"]').click();
    await composer.waitFor({ state: "hidden" });
    const clipped = await demo.locator(".message-scroll").evaluate((scroll) => {
      scroll.scrollTop = 0;
      const viewport = scroll.getBoundingClientRect();
      return ["#session-title", ".user-input-card", ".timeline > :last-child"].filter(
        (selector) => {
          const item = scroll.querySelector(selector).getBoundingClientRect();
          return item.top < viewport.top - 1 || item.bottom > viewport.bottom + 1;
        },
      );
    });
    if (clipped.length) throw new Error(`Final conversation is clipped: ${clipped.join(", ")}`);
    await capture(6500);
    if (await demo.getByRole("alert").count()) throw new Error("Demo contains an error alert");
    if (errors.length) throw new Error(errors.join("\n"));
    const overflow = await demo.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw new Error("Horizontal overflow in demo");
    await demo.setViewportSize({ width: 390, height: 844 });
    await demo.getByRole("button", { name: label("Back to list") }).click();
    await demo
      .getByRole("button", { name: label("New session"), exact: true })
      .first()
      .click();
    await agentSelect.waitFor();
    await agentSelect.selectOption("work");
    await permissionSelect.selectOption("auto");
    const permissionBounds = await permissionSelect.boundingBox();
    if (
      !permissionBounds ||
      permissionBounds.x < 0 ||
      permissionBounds.x + permissionBounds.width > 391
    )
      throw new Error("Permission selector overflows mobile dialog");
    const mobileOverflow = await demo
      .getByRole("dialog", { name: label("New session"), exact: true })
      .evaluate((dialog) => {
        const select = dialog.querySelector("select[required]");
        if (!select) throw new Error("Agent selector is missing");
        const outsideViewport = (element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.left < -1 || bounds.right > innerWidth + 1;
        };
        return (
          document.documentElement.scrollWidth > innerWidth + 1 ||
          dialog.scrollWidth > dialog.clientWidth + 1 ||
          outsideViewport(dialog) ||
          outsideViewport(select)
        );
      });
    if (mobileOverflow) throw new Error("Horizontal overflow in mobile agent selection");
    await demo.getByRole("button", { name: label("Close new session"), exact: true }).click();
    resumable = true;
    await demo.goto(new URL(newSessionPath, origin).href);
    for (const width of [390, 1440]) {
      await demo.setViewportSize({ width, height: 1000 });
      await demo.getByRole("button", { name: label("Resume"), exact: true }).click();
      const modeSelect = demo.getByRole("combobox", {
        name: label("Permission mode"),
        exact: true,
      });
      if ((await modeSelect.inputValue()) !== "default") throw new Error("Resume default changed");
      for (const mode of ["auto", "yolo", "default"]) await modeSelect.selectOption(mode);
      const bounds = await modeSelect.boundingBox();
      if (!bounds || bounds.x < 0 || bounds.x + bounds.width > width + 1)
        throw new Error("Resume permission selector overflows");
      await demo.getByRole("button", { name: label("Close resume session"), exact: true }).click();
    }
    console.log(`Captured ${frame} frames to ${frames}`);
  } catch (error) {
    throw new Error(error.message + "\n" + (await demo.locator("body").innerText()));
  } finally {
    await context.close();
  }
}

const recording = join(frames, "record.js");
const recordArgs = [
  frames,
  origin,
  translateFixture(docsSession, language),
  connectedInteraction,
  docsTimestamp,
  translateFixture(docsUserInput, language),
  docsLogLink(language),
].map((value) => JSON.stringify(value));
await writeFile(
  recording,
  `(page) => (${captureSource(record, language)})(page, ${recordArgs.join(", ")}, ${mockDocsTerminal.toString()})`,
);
const cli = (...args) =>
  execFileSync("playwright-cli", [`-s=${browserSession}`, ...args], { stdio: "inherit" });
try {
  cli("open", "about:blank");
  cli("run-code", "--filename", recording);
} finally {
  cli("close");
}
execFileSync(
  "python3",
  [
    "-c",
    `
import sys
from pathlib import Path
from PIL import Image
paths = sorted(Path(sys.argv[1]).glob('*.png'))
if not paths:
    raise SystemExit('No captured frames')
images = [Image.open(p).convert('RGB') for p in paths]
# One shared palette prevents color shimmer between typing frames.
palette = images[-1].quantize(colors=256, method=Image.Quantize.MEDIANCUT)
frames = [im.quantize(palette=palette, dither=Image.Dither.NONE) for im in images]
durations = [int(p.stem.split('-')[-1]) for p in paths]
frames[0].save(sys.argv[2], save_all=True, append_images=frames[1:],
               duration=durations, loop=0, optimize=True, disposal=1)
size = Path(sys.argv[2]).stat().st_size
print(f'GIF: {sum(durations) / 1000:.2f}s, {size / 1024:.0f} KiB')
if size > 5 * 1024 * 1024:
    raise SystemExit('GIF exceeds 5 MiB budget')
`,
    frames,
    output,
  ],
  { stdio: "inherit" },
);
console.log(`Saved ${output}; source frames retained in ${frames}`);

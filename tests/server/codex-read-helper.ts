import { createCodexSessionSource } from "../../src/server/adapters/codex/codex-session-source.js";
import { SessionReadService } from "../../src/server/application/session-read-service.js";
import { PaneBindingManager } from "../../src/server/interaction/pane-binding-manager.js";

export async function createCodexSessionReadService(
  configDirectory: string,
): Promise<SessionReadService> {
  const source = await createCodexSessionSource(configDirectory);
  const bindings = new PaneBindingManager();
  return new SessionReadService([source], {
    publishBindings: (events) => {
      for (const event of events) bindings.submit(event);
    },
    resolveDisplayTitle: (session) => source.displayTitleFor(session),
    agents: [{ nickname: "default", runtimeName: "Codex" }],
  });
}

import type { ServerConfig } from "./config.js";
import { createAhub } from "./create-hub.js";
import { createApiRouter } from "./http/api-router.js";
import { startServer } from "./http/create-server.js";
import { createTerminalPreviewWebSocket } from "./http/terminal-preview-websocket.js";
import { uploadDirectory } from "./http/upload-routes.js";
import { UploadStore } from "./uploads/store.js";

export async function startNode(config: ServerConfig) {
  const uploads = new UploadStore(await uploadDirectory(config.uploadDirectory));
  await uploads.initialize();
  const hub = await createAhub({
    agents: config.agents,
    socket: config.tmuxSocket,
    claudeReadyScript: config.claudeReadyScript,
    interactionEnabled: config.interactionEnabled,
    uploads,
  });
  return startServer(
    config,
    createApiRouter({ ...hub, uploads }),
    hub.close,
    createTerminalPreviewWebSocket(hub.interaction),
  );
}

import type { IncomingMessage } from "node:http";

export function isSameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  const scheme = "encrypted" in request.socket && request.socket.encrypted ? "https" : "http";
  return origin === `${scheme}://${request.headers.host}`;
}

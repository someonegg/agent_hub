import { NODE_ID_PATTERN } from "../shared/node-id";

const NODE_PATH = new RegExp(`^/nodes/(${NODE_ID_PATTERN})(?=/|$)`);

export function currentNode() {
  return NODE_PATH.exec(window.location.pathname)?.[1];
}

export function nodePagePath(path: string, node = currentNode()) {
  return node ? `/nodes/${node}${path}` : path;
}

export function localPagePath() {
  return window.location.pathname.replace(NODE_PATH, "") || "/";
}

export function nodeApiPath(path: string, node = currentNode()) {
  return node ? path.replace(/^\/api\/v1(?=\/|$)/, `/api/nodes/${node}/v1`) : path;
}

export function nodeStorageKey(key: string, node = currentNode() ?? null) {
  return node ? `${key}.node.${node}` : key;
}

export function subscribeNode(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}

export function navigateNode(path: string, mode: "push" | "replace" = "push") {
  if (mode === "replace") window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

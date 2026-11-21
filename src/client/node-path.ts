const NODE_PATH = /^\/nodes\/([a-z0-9-]+)(?=\/|$)/;

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

export function navigateNode(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

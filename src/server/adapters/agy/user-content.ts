const USER_REQUEST = /^<USER_REQUEST>\r?\n([\s\S]*?)\r?\n<\/USER_REQUEST>(?=\r?\n|$)/;

/** Antigravity wraps the typed text in <USER_REQUEST> followed by metadata blocks. */
export function extractAgyUserRequest(content: string): string {
  const match = USER_REQUEST.exec(content);
  return match ? match[1]! : content;
}

const CONTEXT_INJECTION_BLOCK =
  /^\s*(?:<system-reminder>|<system-context>|<ide_opened_file>|<ide_selection>)/;

export function isClaudeContextInjectionBlock(text: string): boolean {
  return CONTEXT_INJECTION_BLOCK.test(text);
}

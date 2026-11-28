export function validOperationId(id: string): boolean {
  return /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id);
}

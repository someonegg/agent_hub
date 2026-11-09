export type PermissionMode = "default" | "auto" | "yolo";

export function isPermissionMode(value: unknown): value is PermissionMode {
  return value === "default" || value === "auto" || value === "yolo";
}

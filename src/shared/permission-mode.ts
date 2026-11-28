export const PERMISSION_MODES = ["default", "auto", "yolo"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export function isPermissionMode(value: unknown): value is PermissionMode {
  return PERMISSION_MODES.some((mode) => value === mode);
}

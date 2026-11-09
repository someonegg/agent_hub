import type { PermissionMode } from "../../shared/permission-mode";

import { t } from "../i18n";

export function PermissionModeSelect({
  value,
  onChange,
  disabled,
}: {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  disabled?: boolean;
}) {
  return (
    <label>
      {t("permissionMode")}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as PermissionMode)}
      >
        <option value="default">{t("permissionModeDefault")}</option>
        <option value="auto">Auto</option>
        <option value="yolo">YOLO</option>
      </select>
    </label>
  );
}

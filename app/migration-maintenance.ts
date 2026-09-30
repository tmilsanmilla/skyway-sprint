const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

export const resolveMigrationMaintenanceMode = (value?: string) =>
  ENABLED_VALUES.has(value?.trim().toLowerCase() ?? "");

export const isMigrationMaintenanceMode = () =>
  resolveMigrationMaintenanceMode(
    process.env.NEXT_PUBLIC_MIGRATION_MAINTENANCE,
  );

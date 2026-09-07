// Compatibility entry point: always use the complete, transactional upgrade.
await import("./apply-latest-migrations.mjs");

// Compatibility entry point for existing installations.
// The full transactional migration avoids reinstalling obsolete scheduling rules.
await import("./apply-latest-migrations.mjs");

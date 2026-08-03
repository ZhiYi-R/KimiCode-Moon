// Public API surface for the kimi-cli → kimi-code migration tool.

export * from './types.js';
export { detectMigration } from './detect.js';
export {
  shouldSuppressMigration,
  type MigrationSuppressionInput,
} from './marker.js';
export { runMigration, type RunMigrationInput } from './run-migration.js';
export {
  resolveMigrationScope,
  type MigrationPromptResult,
  type AnyChoice,
  type Prompt1Choice,
  type Prompt2Choice,
} from './prompt.js';
export {
  HOME_MIGRATION_MARKER_NAME,
  HOME_MIGRATION_LOCK_NAME,
  HOME_USER_DATA_ENTRIES,
  homeMigrationLock,
  homeMigrationMarker,
  runHomeMigration,
  shouldSuppressHomeMigration,
  targetHasData,
  type HomeMigrationInput,
  type HomeMigrationReason,
  type HomeMigrationResult,
} from './home-migration.js';

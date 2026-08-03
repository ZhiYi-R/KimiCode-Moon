/**
 * Session goal queue (`<sessionDir>/upcoming-goals.json`) for the REST
 * surface.
 *
 * Port of the TUI's `apps/kimi-code/src/tui/goal-queue-store.ts` (same file
 * name, same wire format `{version: 1, goals: [{id, objective, createdAt,
 * updatedAt}]}`, same per-file mutation lock) so the desktop/web GUI and the
 * TUI manage one shared queue. The session dir comes from the Session-scope
 * `ISessionContext.sessionDir`; the file is the session's own, not global.
 *
 * Errors are raised as coded `Error2`; routes map them to wire codes.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Error2, ErrorCodes } from '@moonshot-ai/agent-core-v2';

export const GOAL_QUEUE_FILE = 'upcoming-goals.json';
export const GOAL_QUEUE_VERSION = 1;
export const MAX_GOAL_OBJECTIVE_LENGTH = 4000;

export interface UpcomingGoal {
  readonly id: string;
  readonly objective: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GoalQueueSnapshot {
  readonly goals: readonly UpcomingGoal[];
}

interface GoalQueueFile {
  readonly version: typeof GOAL_QUEUE_VERSION;
  readonly goals: readonly UpcomingGoal[];
}

const queueMutationLocks = new Map<string, Promise<void>>();

export async function readGoalQueue(sessionDir: string): Promise<GoalQueueSnapshot> {
  return toSnapshot(await readQueueFile(sessionDir));
}

export async function appendGoalQueueItem(
  sessionDir: string,
  input: { readonly objective: string },
): Promise<GoalQueueSnapshot> {
  const objective = normalizeObjective(input.objective);
  return withQueueMutationLock(sessionDir, async () => {
    const state = await readQueueFile(sessionDir);
    const now = new Date().toISOString();
    const goal: UpcomingGoal = {
      id: randomUUID(),
      objective,
      createdAt: now,
      updatedAt: now,
    };
    const next: GoalQueueFile = { version: GOAL_QUEUE_VERSION, goals: [...state.goals, goal] };
    await writeQueueFile(sessionDir, next);
    return toSnapshot(next);
  });
}

export async function removeGoalQueueItem(
  sessionDir: string,
  input: { readonly goalId: string },
): Promise<GoalQueueSnapshot> {
  return withQueueMutationLock(sessionDir, async () => {
    const state = await readQueueFile(sessionDir);
    const index = findGoalIndex(state, input.goalId);
    const goals = state.goals.filter((_, goalIndex) => goalIndex !== index);
    const next: GoalQueueFile = { version: GOAL_QUEUE_VERSION, goals };
    await writeQueueFile(sessionDir, next);
    return toSnapshot(next);
  });
}

export async function moveGoalQueueItem(
  sessionDir: string,
  input: { readonly goalId: string; readonly direction: 'up' | 'down' },
): Promise<GoalQueueSnapshot> {
  return withQueueMutationLock(sessionDir, async () => {
    const state = await readQueueFile(sessionDir);
    const index = findGoalIndex(state, input.goalId);
    const targetIndex = input.direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= state.goals.length) {
      return toSnapshot(state);
    }
    const goals = [...state.goals];
    const [goal] = goals.splice(index, 1);
    goals.splice(targetIndex, 0, goal!);
    const next: GoalQueueFile = { version: GOAL_QUEUE_VERSION, goals };
    await writeQueueFile(sessionDir, next);
    return toSnapshot(next);
  });
}

function goalQueuePath(sessionDir: string): string {
  return join(sessionDir, GOAL_QUEUE_FILE);
}

async function readQueueFile(sessionDir: string): Promise<GoalQueueFile> {
  const filePath = goalQueuePath(sessionDir);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (error: unknown) {
    if (isErrno(error, 'ENOENT')) return emptyQueueFile();
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error2(
      ErrorCodes.CONFIG_INVALID,
      `Invalid JSON in goal queue: ${describeError(error)}`,
    );
  }

  if (!isGoalQueueFile(parsed)) {
    const empty = emptyQueueFile();
    await writeQueueFile(sessionDir, empty);
    return empty;
  }

  return parsed;
}

async function writeQueueFile(sessionDir: string, file: GoalQueueFile): Promise<void> {
  const filePath = goalQueuePath(sessionDir);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
}

async function withQueueMutationLock<T>(sessionDir: string, work: () => Promise<T>): Promise<T> {
  const filePath = goalQueuePath(sessionDir);
  const previous = queueMutationLocks.get(filePath) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(work);
  const lock = run.then(
    () => undefined,
    () => undefined,
  );
  queueMutationLocks.set(filePath, lock);
  try {
    return await run;
  } finally {
    if (queueMutationLocks.get(filePath) === lock) {
      queueMutationLocks.delete(filePath);
    }
  }
}

function emptyQueueFile(): GoalQueueFile {
  return { version: GOAL_QUEUE_VERSION, goals: [] };
}

function toSnapshot(file: GoalQueueFile): GoalQueueSnapshot {
  return { goals: file.goals };
}

function normalizeObjective(value: string): string {
  const objective = value.trim();
  if (objective.length === 0) {
    throw new Error2(ErrorCodes.GOAL_OBJECTIVE_EMPTY, 'Goal objective cannot be empty');
  }
  if (objective.length > MAX_GOAL_OBJECTIVE_LENGTH) {
    throw new Error2(
      ErrorCodes.GOAL_OBJECTIVE_TOO_LONG,
      `Goal objective cannot exceed ${MAX_GOAL_OBJECTIVE_LENGTH} characters`,
    );
  }
  return objective;
}

function findGoalIndex(file: GoalQueueFile, goalId: string): number {
  const index = file.goals.findIndex((goal) => goal.id === goalId);
  if (index === -1) {
    throw new Error2(ErrorCodes.GOAL_NOT_FOUND, 'No queued goal found');
  }
  return index;
}

function isGoalQueueFile(value: unknown): value is GoalQueueFile {
  if (!isRecord(value)) return false;
  return (
    value['version'] === GOAL_QUEUE_VERSION &&
    Array.isArray(value['goals']) &&
    value['goals'].every(isUpcomingGoal)
  );
}

function isUpcomingGoal(value: unknown): value is UpcomingGoal {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value['id']) &&
    isNonEmptyString(value['objective']) &&
    isNonEmptyString(value['createdAt']) &&
    isNonEmptyString(value['updatedAt'])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isErrno(error: unknown, code: string): boolean {
  return isRecord(error) && error['code'] === code;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

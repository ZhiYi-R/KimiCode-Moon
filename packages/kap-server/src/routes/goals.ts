/**
 * `/sessions/{session_id}/goals` routes — the session's upcoming-goals queue
 * (the `upcoming-goals.json` file the TUI's `/goal next [manage]` manages).
 *
 * The queue is stored per session (`<sessionDir>/upcoming-goals.json`, same
 * file + format as the TUI), so the GUI and the TUI share one queue. The
 * session must be live (cold sessions resume on demand, mirroring cron).
 *
 * Error mapping: `session.not_found` → 40401; `goal.not_found` → 40914;
 * `goal.objective_empty` / `goal.objective_too_long` / `config.invalid` →
 * 40001; everything else → 50001.
 */

import {
  Error2,
  ErrorCodes,
  ISessionContext,
  resumeSessionById,
  type Scope,
} from '@moonshot-ai/agent-core-v2';

import { errEnvelope, okEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';
import { ErrorCode } from '../protocol/error-codes';
import {
  appendGoalBodySchema,
  appendGoalResponseSchema,
  goalIdParamSchema,
  listGoalsResponseSchema,
  moveGoalBodySchema,
  moveGoalResponseSchema,
  removeGoalResponseSchema,
  sessionIdParamSchema,
  type AppendGoalBody,
  type MoveGoalBody,
  type UpcomingGoal,
} from '../protocol/rest-goals';
import {
  appendGoalQueueItem,
  moveGoalQueueItem,
  readGoalQueue,
  removeGoalQueueItem,
} from '../services/goalQueue/goalQueueService';

interface GoalsRouteHost {
  get(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> } | undefined,
    handler: (
      req: { id: string; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
  post(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; body: unknown; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
  delete(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
}

export function registerGoalsRoutes(app: GoalsRouteHost, core: Scope): void {
  // GET /sessions/{session_id}/goals -------------------------------------
  const listGoalsRoute = defineRoute(
    {
      method: 'GET',
      path: '/sessions/{session_id}/goals',
      params: sessionIdParamSchema,
      success: { data: listGoalsResponseSchema },
      errors: {
        [ErrorCode.SESSION_NOT_FOUND]: {},
      },
      description: 'List the session\'s upcoming-goals queue',
      tags: ['sessions'],
      operationId: 'listGoalQueue',
    },
    async (req, reply) => {
      const { session_id } = req.params as { session_id: string };
      try {
        const sessionDir = await resolveSessionDir(core, session_id);
        const snapshot = await readGoalQueue(sessionDir);
        reply.send(okEnvelope({ goals: snapshot.goals.map(toWireGoal) }, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.get(
    listGoalsRoute.path,
    listGoalsRoute.options,
    listGoalsRoute.handler as Parameters<GoalsRouteHost['get']>[2],
  );

  // POST /sessions/{session_id}/goals ------------------------------------
  const appendGoalRoute = defineRoute(
    {
      method: 'POST',
      path: '/sessions/{session_id}/goals',
      params: sessionIdParamSchema,
      body: appendGoalBodySchema,
      success: { data: appendGoalResponseSchema },
      errors: {
        [ErrorCode.SESSION_NOT_FOUND]: {},
        [ErrorCode.VALIDATION_FAILED]: {},
      },
      description: 'Append a goal to the session\'s upcoming-goals queue',
      tags: ['sessions'],
      operationId: 'appendGoal',
    },
    async (req, reply) => {
      const { session_id } = req.params as { session_id: string };
      const body = req.body as AppendGoalBody;
      try {
        const sessionDir = await resolveSessionDir(core, session_id);
        const snapshot = await appendGoalQueueItem(sessionDir, { objective: body.objective });
        const goal = snapshot.goals[snapshot.goals.length - 1];
        reply.send(okEnvelope({ goal: toWireGoal(goal!) }, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.post(
    appendGoalRoute.path,
    appendGoalRoute.options,
    appendGoalRoute.handler as Parameters<GoalsRouteHost['post']>[2],
  );

  // DELETE /sessions/{session_id}/goals/{goal_id} ------------------------
  const removeGoalRoute = defineRoute(
    {
      method: 'DELETE',
      path: '/sessions/{session_id}/goals/{goal_id}',
      params: goalIdParamSchema,
      success: { data: removeGoalResponseSchema },
      errors: {
        [ErrorCode.SESSION_NOT_FOUND]: {},
        [ErrorCode.GOAL_NOT_FOUND]: {},
      },
      description: 'Remove a goal from the session\'s upcoming-goals queue',
      tags: ['sessions'],
      operationId: 'removeGoal',
    },
    async (req, reply) => {
      const { session_id, goal_id } = req.params as { session_id: string; goal_id: string };
      try {
        const sessionDir = await resolveSessionDir(core, session_id);
        await removeGoalQueueItem(sessionDir, { goalId: goal_id });
        reply.send(okEnvelope({ removed: true }, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.delete(
    removeGoalRoute.path,
    removeGoalRoute.options,
    removeGoalRoute.handler as Parameters<GoalsRouteHost['delete']>[2],
  );

  // POST /sessions/{session_id}/goals/{goal_id}/move ---------------------
  const moveGoalRoute = defineRoute(
    {
      method: 'POST',
      path: '/sessions/{session_id}/goals/{goal_id}/move',
      params: goalIdParamSchema,
      body: moveGoalBodySchema,
      success: { data: moveGoalResponseSchema },
      errors: {
        [ErrorCode.SESSION_NOT_FOUND]: {},
        [ErrorCode.GOAL_NOT_FOUND]: {},
      },
      description: 'Reorder a goal in the session\'s upcoming-goals queue',
      tags: ['sessions'],
      operationId: 'moveGoal',
    },
    async (req, reply) => {
      const { session_id, goal_id } = req.params as { session_id: string; goal_id: string };
      const body = req.body as MoveGoalBody;
      try {
        const sessionDir = await resolveSessionDir(core, session_id);
        await moveGoalQueueItem(sessionDir, { goalId: goal_id, direction: body.direction });
        reply.send(okEnvelope({ moved: true }, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.post(
    moveGoalRoute.path,
    moveGoalRoute.options,
    moveGoalRoute.handler as Parameters<GoalsRouteHost['post']>[2],
  );
}

// ---------------------------------------------------------------------------
// Resolution + projection
// ---------------------------------------------------------------------------

async function resolveSessionDir(core: Scope, sessionId: string): Promise<string> {
  const session = await resumeSessionById(core.accessor, sessionId);
  if (session === undefined) {
    throw new Error2(ErrorCodes.SESSION_NOT_FOUND, `session ${sessionId} does not exist`);
  }
  return session.accessor.get(ISessionContext).sessionDir;
}

function toWireGoal(goal: {
  readonly id: string;
  readonly objective: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}): UpcomingGoal {
  return {
    id: goal.id,
    objective: goal.objective,
    created_at: goal.createdAt,
    updated_at: goal.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

function sendMappedError(
  reply: { send(payload: unknown): unknown },
  requestId: string,
  err: unknown,
): void {
  if (err instanceof Error2) {
    const code = GOALS_ERROR_MAP[err.code];
    if (code !== undefined) {
      reply.send(errEnvelope(code, err.message, requestId, err.stack));
      return;
    }
  }
  throw err;
}

const GOALS_ERROR_MAP: Record<string, ErrorCode> = {
  [ErrorCodes.SESSION_NOT_FOUND]: ErrorCode.SESSION_NOT_FOUND,
  [ErrorCodes.GOAL_NOT_FOUND]: ErrorCode.GOAL_NOT_FOUND,
  [ErrorCodes.GOAL_OBJECTIVE_EMPTY]: ErrorCode.VALIDATION_FAILED,
  [ErrorCodes.GOAL_OBJECTIVE_TOO_LONG]: ErrorCode.VALIDATION_FAILED,
  [ErrorCodes.CONFIG_INVALID]: ErrorCode.VALIDATION_FAILED,
  [ErrorCodes.REQUEST_INVALID]: ErrorCode.VALIDATION_FAILED,
};

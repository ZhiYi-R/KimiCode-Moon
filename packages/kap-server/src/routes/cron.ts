/**
 * `/sessions/{session_id}/cron` routes — session-scoped cron-task management
 * (list, create, delete).
 *
 * Cron is a Session-scope concern bound to the session's main agent: tasks
 * persist per workspace/session (via `ICronTaskPersistence`), and firing
 * borrows the main agent's prompt service to steer a new turn. The LLM's
 * cron-create / cron-delete tools are thin wrappers over the same service
 * (`ISessionCronService.addTask` / `removeTasks`); these routes expose that
 * surface over REST with the tool's validation semantics (5-field local-time
 * cron expression, prompt ≤ 8 KiB, per-session cap of 50).
 *
 * The session must be live (cold sessions are resumed on demand, mirroring
 * the prompts routes).
 */

import {
  Error2,
  ErrorCodes,
  ISessionCronService,
  resumeSessionById,
  type CronTask,
  type Scope,
} from '@moonshot-ai/agent-core-v2';
import { parseCronExpression } from '@moonshot-ai/agent-core-v2/app/cron/cron-expr';

import { okEnvelope, errEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';
import { ErrorCode } from '../protocol/error-codes';
import {
  createCronTaskBodySchema,
  createCronTaskResponseSchema,
  cronTaskParamSchema,
  deleteCronTaskResponseSchema,
  listCronTasksResponseSchema,
  sessionIdParamSchema,
  type CreateCronTaskBody,
  type CronTask as ProtocolCronTask,
} from '../protocol/rest-cron';

interface CronRouteHost {
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

export function registerCronRoutes(app: CronRouteHost, core: Scope): void {
  // GET /sessions/{session_id}/cron --------------------------------------
  const listCronRoute = defineRoute(
    {
      method: 'GET',
      path: '/sessions/{session_id}/cron',
      params: sessionIdParamSchema,
      success: { data: listCronTasksResponseSchema },
      errors: {
        [ErrorCode.SESSION_NOT_FOUND]: {},
      },
      description: 'List the session\'s cron tasks (main agent)',
      tags: ['sessions'],
      operationId: 'listCronTasks',
    },
    async (req, reply) => {
      const { session_id } = req.params as { session_id: string };
      try {
        const cron = await resolveCron(core, session_id);
        const tasks = cron.list().map((task) => toProtocolCronTask(task, cron));
        reply.send(okEnvelope({ tasks }, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.get(
    listCronRoute.path,
    listCronRoute.options,
    listCronRoute.handler as Parameters<CronRouteHost['get']>[2],
  );

  // POST /sessions/{session_id}/cron -------------------------------------
  const createCronRoute = defineRoute(
    {
      method: 'POST',
      path: '/sessions/{session_id}/cron',
      params: sessionIdParamSchema,
      body: createCronTaskBodySchema,
      success: { data: createCronTaskResponseSchema },
      errors: {
        [ErrorCode.SESSION_NOT_FOUND]: {},
        [ErrorCode.VALIDATION_FAILED]: {},
      },
      description: 'Create a cron task for the session (main agent)',
      tags: ['sessions'],
      operationId: 'createCronTask',
    },
    async (req, reply) => {
      const { session_id } = req.params as { session_id: string };
      const body = req.body as CreateCronTaskBody;
      try {
        const cron = await resolveCron(core, session_id);
        assertValidCronExpression(body.cron);
        const task = cron.addTask({
          cron: body.cron,
          prompt: body.prompt,
          recurring: body.recurring,
        });
        reply.send(okEnvelope({ task: toProtocolCronTask(task, cron) }, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.post(
    createCronRoute.path,
    createCronRoute.options,
    createCronRoute.handler as Parameters<CronRouteHost['post']>[2],
  );

  // DELETE /sessions/{session_id}/cron/{task_id} -------------------------
  const deleteCronRoute = defineRoute(
    {
      method: 'DELETE',
      path: '/sessions/{session_id}/cron/{task_id}',
      params: cronTaskParamSchema,
      success: { data: deleteCronTaskResponseSchema },
      errors: {
        [ErrorCode.SESSION_NOT_FOUND]: {},
        [ErrorCode.VALIDATION_FAILED]: {},
      },
      description: 'Delete a cron task from the session',
      tags: ['sessions'],
      operationId: 'deleteCronTask',
    },
    async (req, reply) => {
      const { session_id, task_id } = req.params as { session_id: string; task_id: string };
      try {
        const cron = await resolveCron(core, session_id);
        const removed = cron.removeTasks([task_id]);
        reply.send(okEnvelope({ removed }, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.delete(
    deleteCronRoute.path,
    deleteCronRoute.options,
    deleteCronRoute.handler as Parameters<CronRouteHost['delete']>[2],
  );
}

// ---------------------------------------------------------------------------
// Resolution + projection
// ---------------------------------------------------------------------------

async function resolveCron(core: Scope, sessionId: string): Promise<ISessionCronService> {
  const session = await resolveSession(core, sessionId);
  return session.accessor.get(ISessionCronService);
}

async function resolveSession(
  core: Scope,
  sessionId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof resumeSessionById>>>> {
  // `resume` (not `get`): a persisted-but-cold session is loaded from disk so
  // its cron service reflects the persisted task set.
  const session = await resumeSessionById(core.accessor, sessionId);
  if (session === undefined) {
    throw new Error2(ErrorCodes.SESSION_NOT_FOUND, `session ${sessionId} does not exist`);
  }
  return session;
}

/** Reject malformed expressions with the same semantics as the cron tool. */
function assertValidCronExpression(expr: string): void {
  try {
    parseCronExpression(expr);
  } catch (error) {
    throw new Error2(
      ErrorCodes.REQUEST_INVALID,
      `Invalid cron expression: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function toProtocolCronTask(
  task: CronTask,
  cron: ISessionCronService,
): ProtocolCronTask {
  const nextFireAt = cron.getNextFireForTask(task.id);
  const base: ProtocolCronTask = {
    id: task.id,
    cron: task.cron,
    prompt: task.prompt,
    created_at: task.createdAt,
    next_fire_at: nextFireAt,
  };
  if (task.recurring !== undefined) base.recurring = task.recurring;
  if (task.lastFiredAt !== undefined) base.last_fired_at = task.lastFiredAt;
  return base;
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
    const code = CRON_ERROR_MAP[err.code];
    if (code !== undefined) {
      reply.send(errEnvelope(code, err.message, requestId, err.stack));
      return;
    }
  }
  throw err;
}

const CRON_ERROR_MAP: Record<string, ErrorCode> = {
  [ErrorCodes.SESSION_NOT_FOUND]: ErrorCode.SESSION_NOT_FOUND,
  [ErrorCodes.REQUEST_INVALID]: ErrorCode.VALIDATION_FAILED,
  [ErrorCodes.CONFIG_INVALID]: ErrorCode.VALIDATION_FAILED,
};

/**
 * `/workspaces/{workspace_id}/dirs` routes — workspace additional-directory
 * management (list, add, remove).
 *
 * Thin wrapper over the Workspace-scoped `IWorkspaceDirs` service (the same
 * service `session.addAdditionalDir` drives over RPC): the handler-level
 * `{root, additionalDirs[]}` set backed by `.kimi-code/local.toml`. Changes
 * fan out to every session of the handler immediately (the fs services
 * re-read the live set per call), no restart needed.
 *
 * Error mapping: unknown workspace → 40410; invalid dir (missing / not a
 * directory) → 40001; everything else → 50001.
 */

import {
  Error2,
  ErrorCodes,
  IWorkspaceDirs,
  IWorkspaceLifecycleService,
  IWorkspaceService,
  type Scope,
} from '@moonshot-ai/agent-core-v2';

import { errEnvelope, okEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';
import { ErrorCode } from '../protocol/error-codes';
import {
  addWorkspaceDirBodySchema,
  workspaceDirsQuerySchema,
  workspaceDirsResponseSchema,
  workspaceIdParamSchema,
  type AddWorkspaceDirBody,
} from '../protocol/rest-workspace-dirs';

interface WorkspaceDirsRouteHost {
  get(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> } | undefined,
    handler: (
      req: { id: string; params: unknown; query: unknown },
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
      req: { id: string; params: unknown; query: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
}

export function registerWorkspaceDirsRoutes(app: WorkspaceDirsRouteHost, core: Scope): void {
  // GET /workspaces/{workspace_id}/dirs -----------------------------------
  const listDirsRoute = defineRoute(
    {
      method: 'GET',
      path: '/workspaces/{workspace_id}/dirs',
      params: workspaceIdParamSchema,
      success: { data: workspaceDirsResponseSchema },
      errors: {
        [ErrorCode.WORKSPACE_NOT_FOUND]: {},
      },
      description: 'List the workspace\'s additional directories',
      tags: ['workspaces'],
      operationId: 'listWorkspaceDirs',
    },
    async (req, reply) => {
      const { workspace_id } = req.params as { workspace_id: string };
      const dirs = await resolveWorkspaceDirs(core, workspace_id, req.id, reply);
      if (dirs === undefined) return;
      reply.send(okEnvelope({ additional_dirs: [...dirs.additionalDirs] }, req.id));
    },
  );
  app.get(
    listDirsRoute.path,
    listDirsRoute.options,
    listDirsRoute.handler as Parameters<WorkspaceDirsRouteHost['get']>[2],
  );

  // POST /workspaces/{workspace_id}/dirs ---------------------------------
  const addDirRoute = defineRoute(
    {
      method: 'POST',
      path: '/workspaces/{workspace_id}/dirs',
      params: workspaceIdParamSchema,
      body: addWorkspaceDirBodySchema,
      success: { data: workspaceDirsResponseSchema },
      errors: {
        [ErrorCode.WORKSPACE_NOT_FOUND]: {},
        [ErrorCode.VALIDATION_FAILED]: {},
      },
      description: 'Add an additional directory to the workspace',
      tags: ['workspaces'],
      operationId: 'addWorkspaceDir',
    },
    async (req, reply) => {
      const { workspace_id } = req.params as { workspace_id: string };
      const body = req.body as AddWorkspaceDirBody;
      const dirs = await resolveWorkspaceDirs(core, workspace_id, req.id, reply);
      if (dirs === undefined) return;
      try {
        const result = await dirs.addDir({ path: body.dir, persist: body.persist });
        reply.send(okEnvelope(projectDirs(result), req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.post(
    addDirRoute.path,
    addDirRoute.options,
    addDirRoute.handler as Parameters<WorkspaceDirsRouteHost['post']>[2],
  );

  // DELETE /workspaces/{workspace_id}/dirs?dir=<path> ---------------------
  const removeDirRoute = defineRoute(
    {
      method: 'DELETE',
      path: '/workspaces/{workspace_id}/dirs',
      params: workspaceIdParamSchema,
      querystring: workspaceDirsQuerySchema,
      success: { data: workspaceDirsResponseSchema },
      errors: {
        [ErrorCode.WORKSPACE_NOT_FOUND]: {},
        [ErrorCode.VALIDATION_FAILED]: {},
      },
      description: 'Remove an additional directory from the workspace (query: ?dir=<path>)',
      tags: ['workspaces'],
      operationId: 'removeWorkspaceDir',
    },
    async (req, reply) => {
      const { workspace_id } = req.params as { workspace_id: string };
      const { dir } = req.query as { dir: string };
      const dirs = await resolveWorkspaceDirs(core, workspace_id, req.id, reply);
      if (dirs === undefined) return;
      try {
        const result = await dirs.removeDir({ dir });
        reply.send(okEnvelope(projectDirs(result), req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.delete(
    removeDirRoute.path,
    removeDirRoute.options,
    removeDirRoute.handler as Parameters<WorkspaceDirsRouteHost['delete']>[2],
  );
}

// ---------------------------------------------------------------------------
// Resolution + projection
// ---------------------------------------------------------------------------

type DirsReply = { send(payload: unknown): unknown };

async function resolveWorkspaceDirs(
  core: Scope,
  workspaceId: string,
  requestId: string,
  reply: DirsReply,
): Promise<IWorkspaceDirs | undefined> {
  const ws = await core.accessor.get(IWorkspaceService).get(workspaceId);
  if (ws === undefined) {
    reply.send(
      errEnvelope(
        ErrorCode.WORKSPACE_NOT_FOUND,
        `workspace ${workspaceId} does not exist`,
        requestId,
      ),
    );
    return undefined;
  }
  const handle = await core
    .accessor.get(IWorkspaceLifecycleService)
    .handlerFor({ workspaceId, root: ws.root });
  return handle.accessor.get(IWorkspaceDirs);
}

function projectDirs(
  result: {
    additionalDirs: readonly string[];
    projectRoot: string;
    configPath: string;
    persisted: boolean;
  },
): {
  additional_dirs: string[];
  project_root: string;
  config_path: string;
  persisted: boolean;
} {
  return {
    additional_dirs: [...result.additionalDirs],
    project_root: result.projectRoot,
    config_path: result.configPath,
    persisted: result.persisted,
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
    const code = DIRS_ERROR_MAP[err.code];
    if (code !== undefined) {
      reply.send(errEnvelope(code, err.message, requestId, err.stack));
      return;
    }
  }
  throw err;
}

const DIRS_ERROR_MAP: Record<string, ErrorCode> = {
  [ErrorCodes.REQUEST_INVALID]: ErrorCode.VALIDATION_FAILED,
  [ErrorCodes.CONFIG_INVALID]: ErrorCode.VALIDATION_FAILED,
};

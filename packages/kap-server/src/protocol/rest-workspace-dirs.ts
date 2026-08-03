/**
 * REST wire schemas for workspace additional-directory management
 * (`/workspaces/{workspace_id}/dirs`).
 */

import { z } from 'zod';

export const workspaceIdParamSchema = z.object({
  workspace_id: z.string().min(1),
});
export type WorkspaceIdParam = z.infer<typeof workspaceIdParamSchema>;

export const workspaceDirsQuerySchema = z.object({
  /** Directory path to remove (query param: paths contain slashes). */
  dir: z.string().min(1),
});
export type WorkspaceDirsQuery = z.infer<typeof workspaceDirsQuerySchema>;

export const workspaceDirsResponseSchema = z.object({
  additional_dirs: z.array(z.string()),
  /** Present on mutation responses (add/remove); omitted on plain listing. */
  project_root: z.string().optional(),
  config_path: z.string().optional(),
  persisted: z.boolean().optional(),
});
export type WorkspaceDirsResponse = z.infer<typeof workspaceDirsResponseSchema>;

export const addWorkspaceDirBodySchema = z.object({
  dir: z.string().min(1),
  persist: z.boolean().optional(),
});
export type AddWorkspaceDirBody = z.infer<typeof addWorkspaceDirBodySchema>;

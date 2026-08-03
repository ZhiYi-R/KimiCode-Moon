/**
 * REST wire schemas for session cron-task management
 * (`/sessions/{session_id}/cron`).
 */

import { z } from 'zod';

export const sessionIdParamSchema = z.object({
  session_id: z.string().min(1),
});
export type SessionIdParam = z.infer<typeof sessionIdParamSchema>;

export const cronTaskParamSchema = z.object({
  session_id: z.string().min(1),
  task_id: z.string().min(1),
});
export type CronTaskParam = z.infer<typeof cronTaskParamSchema>;

/** Cron task snapshot as served over REST (session-scoped, main agent). */
export const cronTaskSchema = z.object({
  id: z.string(),
  cron: z.string(),
  prompt: z.string(),
  recurring: z.boolean().optional(),
  created_at: z.number(),
  last_fired_at: z.number().optional(),
  next_fire_at: z.number().nullable(),
});
export type CronTask = z.infer<typeof cronTaskSchema>;

export const listCronTasksResponseSchema = z.object({
  tasks: z.array(cronTaskSchema),
});
export type ListCronTasksResponse = z.infer<typeof listCronTasksResponseSchema>;

export const createCronTaskBodySchema = z.object({
  /** 5-field local-timezone cron expression: `"M H DoM Mon DoW"`. */
  cron: z.string().min(1),
  /** Prompt body to steer on fire; capped at 8 KiB like the tool. */
  prompt: z.string().min(1).max(8 * 1024),
  recurring: z.boolean().optional(),
});
export type CreateCronTaskBody = z.infer<typeof createCronTaskBodySchema>;

export const createCronTaskResponseSchema = z.object({
  task: cronTaskSchema,
});
export type CreateCronTaskResponse = z.infer<typeof createCronTaskResponseSchema>;

export const deleteCronTaskResponseSchema = z.object({
  removed: z.array(z.string()),
});
export type DeleteCronTaskResponse = z.infer<typeof deleteCronTaskResponseSchema>;

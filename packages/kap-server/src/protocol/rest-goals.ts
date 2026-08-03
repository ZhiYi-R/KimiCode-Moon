/**
 * REST wire schemas for the session goal queue
 * (`/sessions/{session_id}/goals`), the shared upcoming-goals.json surface.
 */

import { z } from 'zod';

export const sessionIdParamSchema = z.object({
  session_id: z.string().min(1),
});
export type SessionIdParam = z.infer<typeof sessionIdParamSchema>;

export const goalIdParamSchema = z.object({
  session_id: z.string().min(1),
  goal_id: z.string().min(1),
});
export type GoalIdParam = z.infer<typeof goalIdParamSchema>;

export const upcomingGoalSchema = z.object({
  id: z.string(),
  objective: z.string(),
  /** ISO-8601 timestamps, matching the on-disk file format. */
  created_at: z.string(),
  updated_at: z.string(),
});
export type UpcomingGoal = z.infer<typeof upcomingGoalSchema>;

export const listGoalsResponseSchema = z.object({
  goals: z.array(upcomingGoalSchema),
});
export type ListGoalsResponse = z.infer<typeof listGoalsResponseSchema>;

export const appendGoalBodySchema = z.object({
  objective: z.string().min(1).max(4000),
});
export type AppendGoalBody = z.infer<typeof appendGoalBodySchema>;

export const appendGoalResponseSchema = z.object({
  goal: upcomingGoalSchema,
});
export type AppendGoalResponse = z.infer<typeof appendGoalResponseSchema>;

export const removeGoalResponseSchema = z.object({
  removed: z.literal(true),
});
export type RemoveGoalResponse = z.infer<typeof removeGoalResponseSchema>;

export const moveGoalBodySchema = z.object({
  direction: z.enum(['up', 'down']),
});
export type MoveGoalBody = z.infer<typeof moveGoalBodySchema>;

export const moveGoalResponseSchema = z.object({
  moved: z.literal(true),
});
export type MoveGoalResponse = z.infer<typeof moveGoalResponseSchema>;

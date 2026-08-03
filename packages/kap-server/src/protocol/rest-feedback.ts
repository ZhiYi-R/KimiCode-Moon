/**
 * REST wire schemas for `POST /feedback` (managed-platform feedback proxy).
 */

import { z } from 'zod';

export const submitFeedbackBodySchema = z.object({
  session_id: z.string().min(1),
  content: z.string().min(1).max(100_000),
  /** Optional contact (e.g. email) for follow-ups. */
  contact: z.string().max(500).optional(),
  /** Optional structured diagnostics. */
  info: z.record(z.string(), z.unknown()).optional(),
});
export type SubmitFeedbackBody = z.infer<typeof submitFeedbackBodySchema>;

export const submitFeedbackResponseSchema = z.object({
  submitted: z.literal(true),
  feedback_id: z.number().int().optional(),
});
export type SubmitFeedbackResponse = z.infer<typeof submitFeedbackResponseSchema>;

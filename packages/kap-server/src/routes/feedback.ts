/**
 * `/feedback` route — proxy user feedback to the managed Kimi Code platform.
 *
 * The browser never holds the managed OAuth token, so the server submits on
 * its behalf: resolve the cached managed access token from `IOAuthService`,
 * fill the host identity (`version`, `os`), and POST to the platform's
 * `/feedback` endpoint (reusing `@moonshot-ai/kimi-code-oauth`'s
 * `fetchSubmitFeedback`).
 *
 * Error mapping: no managed credential → 40111; upstream failure → 50001
 * with the upstream message; invalid body → 40001 (zod).
 */

import {
  Error2,
  ErrorCodes,
  IOAuthService,
  type Scope,
} from '@moonshot-ai/agent-core-v2';
import {
  fetchSubmitFeedback,
  kimiCodeFeedbackUrl,
  KIMI_CODE_PROVIDER_NAME,
} from '@moonshot-ai/kimi-code-oauth';

import { errEnvelope, okEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';
import { ErrorCode } from '../protocol/error-codes';
import {
  submitFeedbackBodySchema,
  submitFeedbackResponseSchema,
  type SubmitFeedbackBody,
} from '../protocol/rest-feedback';

interface FeedbackRouteHost {
  post(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; body: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
}

export function registerFeedbackRoute(
  app: FeedbackRouteHost,
  core: Scope,
  hostVersion: string,
): void {
  const submitFeedbackRoute = defineRoute(
    {
      method: 'POST',
      path: '/feedback',
      body: submitFeedbackBodySchema,
      success: { data: submitFeedbackResponseSchema },
      errors: {
        [ErrorCode.AUTH_TOKEN_MISSING]: {},
        [ErrorCode.VALIDATION_FAILED]: {},
      },
      description: 'Submit feedback to the managed Kimi Code platform',
      tags: ['meta'],
      operationId: 'submitFeedback',
    },
    async (req, reply) => {
      const body = req.body as SubmitFeedbackBody;
      const oauth = core.accessor.get(IOAuthService);
      const accessToken = await oauth.getCachedAccessToken(KIMI_CODE_PROVIDER_NAME);
      if (accessToken === undefined) {
        reply.send(
          errEnvelope(
            ErrorCode.AUTH_TOKEN_MISSING,
            'no managed Kimi Code credential; log in first',
            req.id,
          ),
        );
        return;
      }
      const result = await fetchSubmitFeedback(
        kimiCodeFeedbackUrl(),
        accessToken,
        {
          session_id: body.session_id,
          content: body.content,
          version: hostVersion,
          os: process.platform,
          model: null,
          ...(body.contact !== undefined ? { contact: body.contact } : {}),
          ...(body.info !== undefined ? { info: body.info } : {}),
        },
        { timeoutMs: 15_000 },
      );
      if (result.kind === 'error') {
        throw new Error2(
          ErrorCodes.INTERNAL,
          result.message,
          result.status !== undefined ? { details: { http_status: result.status } } : undefined,
        );
      }
      reply.send(okEnvelope({ submitted: true, feedback_id: result.feedbackId }, req.id));
    },
  );
  app.post(
    submitFeedbackRoute.path,
    submitFeedbackRoute.options,
    submitFeedbackRoute.handler as Parameters<FeedbackRouteHost['post']>[2],
  );
}

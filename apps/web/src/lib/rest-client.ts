import {
  problemDetailsSchema,
  sessionIdentitySchema,
  technicalActionResponseSchema,
  type ProblemDetails,
  type SessionIdentity,
  type TechnicalAction,
  type TechnicalActionResponse,
} from "@arquibancada-viva/contracts";

export class RestClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly problem?: ProblemDetails,
  ) {
    super(code);
    this.name = "RestClientError";
  }
}

function endpoint(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\//u, ""), normalizedBase).toString();
}

export interface RestClient {
  getSession(): Promise<SessionIdentity>;
  submitTechnicalAction(input: {
    readonly action: TechnicalAction;
    readonly idempotencyKey: string;
    readonly matchId: string;
  }): Promise<TechnicalActionResponse>;
}

async function responsePayload(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined);
}

function throwForResponse(response: Response, payload: unknown): never {
  const parsedProblem = problemDetailsSchema.safeParse(payload);
  throw new RestClientError(
    parsedProblem.success ? parsedProblem.data.code : "REQUEST_FAILED",
    response.status,
    parsedProblem.success ? parsedProblem.data : undefined,
  );
}

export function createRestClient(
  baseUrl: string,
  fetcher: typeof fetch = globalThis.fetch,
): RestClient {
  return {
    async getSession() {
      const response = await fetcher(endpoint(baseUrl, "/v1/me/session"), {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throwForResponse(response, payload);
      }
      const parsedIdentity = sessionIdentitySchema.safeParse(payload);
      if (!parsedIdentity.success) {
        throw new RestClientError("INVALID_RESPONSE", 502);
      }
      return parsedIdentity.data;
    },
    async submitTechnicalAction(input) {
      const response = await fetcher(
        endpoint(baseUrl, `/v1/technical/matches/${encodeURIComponent(input.matchId)}/actions`),
        {
          body: JSON.stringify({ action: input.action, version: 1 }),
          credentials: "include",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "idempotency-key": input.idempotencyKey,
          },
          method: "POST",
        },
      );
      const payload = await responsePayload(response);
      if (!response.ok) {
        throwForResponse(response, payload);
      }
      const parsed = technicalActionResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new RestClientError("INVALID_RESPONSE", 502);
      }
      return parsed.data;
    },
  };
}

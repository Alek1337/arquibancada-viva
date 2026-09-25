import {
  problemDetailsSchema,
  sessionIdentitySchema,
  type ProblemDetails,
  type SessionIdentity,
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
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsedProblem = problemDetailsSchema.safeParse(payload);
        throw new RestClientError(
          parsedProblem.success ? parsedProblem.data.code : "REQUEST_FAILED",
          response.status,
          parsedProblem.success ? parsedProblem.data : undefined,
        );
      }
      const parsedIdentity = sessionIdentitySchema.safeParse(payload);
      if (!parsedIdentity.success) {
        throw new RestClientError("INVALID_RESPONSE", 502);
      }
      return parsedIdentity.data;
    },
  };
}

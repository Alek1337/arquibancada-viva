import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";

export interface AuthRequestInput {
  readonly baseURL: string;
  readonly body: unknown;
  readonly headers: IncomingHttpHeaders;
  readonly method: string;
  readonly url: string;
}

function requestBody(body: unknown) {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (typeof body === "string" || body instanceof Uint8Array) {
    return body;
  }
  return JSON.stringify(body);
}

export function createAuthWebRequest(input: AuthRequestInput): Request {
  const body = requestBody(input.body);
  return new Request(new URL(input.url, input.baseURL), {
    method: input.method,
    headers: fromNodeHeaders(input.headers),
    ...(body === undefined ? {} : { body }),
  });
}

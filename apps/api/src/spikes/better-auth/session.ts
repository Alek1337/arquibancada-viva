import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";
import type { BetterAuthSpike } from "./auth.js";

export function resolveBetterAuthSession(auth: BetterAuthSpike, headers: IncomingHttpHeaders) {
  return auth.api.getSession({ headers: fromNodeHeaders(headers) });
}

export type BetterAuthSession = Exclude<Awaited<ReturnType<typeof resolveBetterAuthSession>>, null>;

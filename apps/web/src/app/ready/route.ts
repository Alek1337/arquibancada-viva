import { parseClientConfig } from "@arquibancada-viva/config/client";

export const dynamic = "force-dynamic";

export function readinessResponse(environment: Parameters<typeof parseClientConfig>[0]): Response {
  try {
    parseClientConfig(environment);
    return Response.json(
      { checks: { configuration: "up" }, service: "web", status: "ready" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        checks: { configuration: "down" },
        service: "web",
        status: "not_ready",
      },
      { headers: { "cache-control": "no-store" }, status: 503 },
    );
  }
}

export function GET(): Response {
  return readinessResponse(process.env);
}

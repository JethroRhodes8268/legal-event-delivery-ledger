import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";

export const legalEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("matter.intake.received"),
    eventId: z.string().min(1),
    matterId: z.string().min(1),
    prospectiveClientId: z.string().min(1),
    receivedAt: z.string().datetime(),
  }),
  z.object({
    type: z.literal("document.signed.delivered"),
    eventId: z.string().min(1),
    matterId: z.string().min(1),
    documentId: z.string().min(1),
    deliveredAt: z.string().datetime(),
  }),
  z.object({
    type: z.literal("deadline.follow_up.due"),
    eventId: z.string().min(1),
    matterId: z.string().min(1),
    deadlineId: z.string().min(1),
    dueAt: z.string().datetime(),
  }),
]);

export type LegalEvent = z.infer<typeof legalEventSchema>;

export type IntakeDecision =
  | { state: "recorded"; event: LegalEvent }
  | { state: "duplicate"; eventId: string };

export function signBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifySignature(
  rawBody: string,
  suppliedSignature: string,
  secret: string,
): boolean {
  const expected = Buffer.from(signBody(rawBody, secret), "hex");
  const supplied = Buffer.from(suppliedSignature.replace(/^sha256=/, ""), "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function acceptLegalEvent(
  rawBody: string,
  signature: string,
  secret: string,
  seenEventIds: Set<string>,
): IntakeDecision {
  if (!verifySignature(rawBody, signature, secret)) {
    throw new Error("Signature verification failed");
  }
  const event = legalEventSchema.parse(JSON.parse(rawBody));
  if (seenEventIds.has(event.eventId)) return { state: "duplicate", eventId: event.eventId };
  seenEventIds.add(event.eventId);
  return { state: "recorded", event };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: ServerResponse, status: number, value: object): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

export function createLegalWebhookServer(secret: string) {
  const seenEventIds = new Set<string>();
  return createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/webhooks/legal-events") {
      json(response, 404, { message: "Route not found" });
      return;
    }

    try {
      const rawBody = await readBody(request);
      const signature = request.headers["x-infrai-signature"];
      if (typeof signature !== "string") {
        json(response, 401, { message: "Signature required" });
        return;
      }
      const decision = acceptLegalEvent(rawBody, signature, secret, seenEventIds);
      json(response, decision.state === "recorded" ? 202 : 200, decision);
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        json(response, 400, { message: "Invalid legal event body" });
        return;
      }
      json(response, 401, { message: "Signature verification failed" });
    }
  });
}

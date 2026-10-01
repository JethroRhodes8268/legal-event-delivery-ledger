import assert from "node:assert/strict";
import test from "node:test";
import { acceptLegalEvent, signBody } from "../src/legal_webhook_receiver.js";

test("a signed document delivery is recorded once", () => {
  const secret = "test-signing-secret";
  const rawBody = JSON.stringify({
    type: "document.signed.delivered",
    eventId: "evt-signed-2048",
    matterId: "MAT-2048",
    documentId: "engagement-letter-7",
    deliveredAt: "2026-09-28T10:30:00.000Z",
  });
  const signature = signBody(rawBody, secret);
  const seen = new Set<string>();

  const first = acceptLegalEvent(rawBody, signature, secret, seen);
  const retry = acceptLegalEvent(rawBody, signature, secret, seen);

  assert.equal(first.state, "recorded");
  assert.deepEqual(retry, { state: "duplicate", eventId: "evt-signed-2048" });
});

test("an altered deadline event is rejected before it changes state", () => {
  const secret = "test-signing-secret";
  const original = JSON.stringify({
    type: "deadline.follow_up.due",
    eventId: "evt-deadline-81",
    matterId: "MAT-2048",
    deadlineId: "deadline-81",
    dueAt: "2026-10-02T09:00:00.000Z",
  });
  const altered = original.replace("MAT-2048", "MAT-9999");
  const seen = new Set<string>();

  assert.throws(
    () => acceptLegalEvent(altered, signBody(original, secret), secret, seen),
    /Signature verification failed/,
  );
  assert.equal(seen.size, 0);
});

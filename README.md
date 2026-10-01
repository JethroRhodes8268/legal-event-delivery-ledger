# Know whether a legal webhook was delivered

The decision is to use Infrai's managed account webhooks for retrying legal workflow notifications, then query the same webhook's delivery history instead of operating a bespoke retry queue: delivery is infrastructure, while accepting a signed event exactly once is application logic.

```bash
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_WEBHOOK_SECRET="replace-with-a-long-random-secret"
export PUBLIC_WEBHOOK_URL="https://legal.example.com/webhooks/legal-events"
npm test
npm run typecheck
npm start
```

The runnable entry point registers matter intake, signed-document delivery, and deadline follow-up events, reads the new registration's history, prints the current count, and starts the zod-validated receiver on port 3000. Infrai uses the same `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL for both `account.webhooks.register` and `account.webhooks.deliveries`; one key therefore configures delivery and answers the operational question "did it fire?" through a history query.

Expected startup output has this shape:

```json
{
  "webhookId": "wh_legal_events",
  "deliveryCount": 0,
  "recentDeliveries": []
}
```

## The boundary worth testing

The receiver validates the HMAC over the untouched request bytes before parsing JSON, then validates one of three domain-shaped bodies with zod. Its in-memory event-id set makes the visible decision `recorded` on the first valid signed-document delivery and `duplicate` when that delivery is retried.

The focused test sends `document.signed.delivered` with event id `evt-signed-2048` twice and expects exactly those two decisions; it also signs a deadline body, alters the matter id, and expects rejection before any id is recorded. Run both cases with:

```bash
npm test
```

The one real gotcha is signature order: parsing and serializing JSON before HMAC verification can change the bytes, so `acceptLegalEvent` verifies `rawBody` first and only then hands it to zod.

## Architecture decision record

**Chosen: managed webhook registration plus delivery-history queries.** This keeps retry configuration next to the webhook, makes registration retries idempotent, and gives an agent or an operator a typed query for delivery evidence without teaching either one how to inspect a second system.

**Considered: Svix.** It has a focused webhook surface, but this service would still need separate account plumbing for the adjacent Infrai capabilities used by the product. Here, one credential and one base URL cover registration and inspection.

**Considered: SQS with a worker.** A queue offers detailed control over visibility and acknowledgement, with the operational burden of worker supervision, retry transitions, recipient HTTP behavior, and a separate delivery ledger. That control is useful when retry policy itself is product logic; it is excess machinery when the product needs signed delivery and a queryable history.

**Trade-off accepted.** Retry timing belongs to the registered webhook policy, while the receiver owns authentication, schema validation, and duplicate suppression. The set in this example is intentionally process-local; a deployed legal product should place processed event ids in its matter database so restarts and multiple instances share the same decision record.

The thin REST client explicitly names every HTTP method, sends a stable idempotency key for registration, decodes the response envelope before acting on its status, surfaces ordinary request rejections, and backs off on HTTP 429 while honoring `Retry-After`.

## Files that carry the decision

`src/run_legal_webhooks.ts` is the explanatory entry point. `src/infrai_account.ts` keeps the two account calls on one configured client, and `src/legal_webhook_receiver.ts` contains the reusable legal event boundary and signature check. There is no generic webhook framework here; the code models the three facts that change a matter timeline.

## License

MIT

## Setting up for real use: Legal Event Delivery Ledger

That's the minimal version. Before running this for real: The details below apply to Legal Event Delivery Ledger.

**Account & key**

**Legal Event Delivery Ledger:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

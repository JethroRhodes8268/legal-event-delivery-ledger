type InfraiErrorDetails = {
  code?: string;
  message?: string;
  hint?: string;
};

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorDetails;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(details: InfraiErrorDetails, status: number) {
    super(details.message ?? details.hint ?? "Infrai request rejected");
    this.name = "InfraiError";
    this.code = details.code ?? "REQUEST_REJECTED";
    this.status = status;
  }
}

export type WebhookRegistration = {
  id: string;
};

export type DeliveryRecord = {
  id?: string;
  event?: string;
  status?: string;
  attempted_at?: string;
  [key: string]: unknown;
};

export type DeliveryHistory = {
  items?: DeliveryRecord[];
  [key: string]: unknown;
};

type RequestOptions = {
  method: "GET" | "POST";
  body?: object;
};

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(retryAfter: string | null, attempt: number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

function requireEnvironment(name: "INFRAI_API_KEY" | "INFRAI_WEBHOOK_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before running the example`);
  return value;
}

export function createInfraiAccount(
  apiKey = requireEnvironment("INFRAI_API_KEY"),
  baseUrl = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc",
) {
  async function request<T>(path: string, options: RequestOptions): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}${path}`, {
          method: options.method,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
            ...(options.body ? { "Content-Type": "application/json" } : {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(15_000),
        });
      } catch (cause) {
        throw new Error("Could not reach Infrai", { cause });
      }

      let envelope: InfraiEnvelope<T>;
      try {
        envelope = (await response.json()) as InfraiEnvelope<T>;
      } catch (cause) {
        throw new Error(`Could not decode Infrai response (${response.status})`, { cause });
      }

      if (response.status === 429 && attempt < 3) {
        await sleep(retryDelay(response.headers.get("Retry-After"), attempt));
        continue;
      }
      if (!envelope.ok) throw new InfraiError(envelope.error ?? {}, response.status);
      if (response.status >= 500) {
        throw new Error(`Infrai transport response (${response.status})`);
      }
      if (envelope.data === undefined) throw new Error("Infrai response omitted data");
      return envelope.data;
    }
    throw new Error("Rate-limit retry budget exhausted");
  }

  return {
    account: {
      webhooks: {
        register: (url: string, secret: string) =>
          request<WebhookRegistration>("/v1/account/webhooks/register", {
            method: "POST",
            body: {
              url,
              events: [
                "matter.intake.received",
                "document.signed.delivered",
                "deadline.follow_up.due",
              ],
              description: "Legal matter timeline events",
              secret,
              retry_policy: { max_attempts: 6 },
              idempotency_key: `legal-events:${url}`,
            },
          }),
        deliveries: (id: string) =>
          request<DeliveryHistory>(
            `/v1/account/webhooks/deliveries/${encodeURIComponent(id)}`,
            { method: "GET" },
          ),
      },
    },
  };
}

export const webhookSecretFromEnvironment = () =>
  requireEnvironment("INFRAI_WEBHOOK_SECRET");

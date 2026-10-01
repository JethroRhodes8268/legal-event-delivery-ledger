import { createInfraiAccount, InfraiError, webhookSecretFromEnvironment } from "./infrai_account.js";
import { createLegalWebhookServer } from "./legal_webhook_receiver.js";

const publicUrl = process.env.PUBLIC_WEBHOOK_URL;
if (!publicUrl) throw new Error("Set PUBLIC_WEBHOOK_URL to the public receiver URL");

const secret = webhookSecretFromEnvironment();
const port = Number(process.env.PORT ?? 3000);
const infrai = createInfraiAccount();

try {
  const registration = await infrai.account.webhooks.register(publicUrl, secret);
  const history = await infrai.account.webhooks.deliveries(registration.id);

  console.log(JSON.stringify({
    webhookId: registration.id,
    deliveryCount: history.items?.length ?? 0,
    recentDeliveries: history.items ?? [],
  }, null, 2));

  createLegalWebhookServer(secret).listen(port, () => {
    console.log(`Legal webhook receiver listening on http://localhost:${port}/webhooks/legal-events`);
  });
} catch (error) {
  if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
    console.error(`Registration rejected (${error.status}): ${error.message}`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}

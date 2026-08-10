import { setTimeout as delay } from "node:timers/promises";

const apiUrl = process.env.SENDRY_DEV_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? 4010}/api/health`;
const timeoutMs = Number(process.env.SENDRY_DEV_API_TIMEOUT_MS ?? 60_000);
const startedAt = Date.now();

process.stdout.write(`Waiting for Sendry API at ${apiUrl}\n`);

while (Date.now() - startedAt < timeoutMs) {
  try {
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(1_000) });
    if (response.ok) {
      process.stdout.write("Sendry API is ready\n");
      process.exit(0);
    }
  } catch {
    // The API is still starting. Retry until the bounded timeout expires.
  }

  await delay(100);
}

process.stderr.write(`Sendry API did not become ready within ${timeoutMs}ms\n`);
process.exit(1);

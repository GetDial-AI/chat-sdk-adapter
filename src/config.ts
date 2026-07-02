// Resolve user-provided options + env vars into a fully-populated config.
// Kept in a pure function so tests don't have to construct the adapter to
// exercise env-fallback logic, and so the class body stays free of process.env
// lookups.

import { ValidationError } from "@chat-adapter/shared";
import { ConsoleLogger } from "chat";
import type { DialAdapterOptions, ResolvedOptions } from "./types";

const DEFAULT_API_BASE_URL = "https://api.getdial.ai";
const DEFAULT_BOT_NAME = "bot";
const ADAPTER_NAMESPACE = "dial";

const ENV = {
  API_KEY: "DIAL_API_KEY",
  FROM_NUMBER_ID: "DIAL_FROM_NUMBER_ID",
  WEBHOOK_SECRET: "DIAL_WEBHOOK_SECRET",
  API_BASE_URL: "DIAL_API_URL",
  BOT_NAME: "BOT_USERNAME",
} as const;

export function resolveOptions(
  options: DialAdapterOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): ResolvedOptions {
  const apiKey = options.apiKey ?? env[ENV.API_KEY];
  if (!apiKey) {
    throw new ValidationError(
      ADAPTER_NAMESPACE,
      `apiKey is required — pass it in options or set ${ENV.API_KEY} in the environment.`,
    );
  }

  const fromNumberId = options.fromNumberId ?? env[ENV.FROM_NUMBER_ID];
  if (!fromNumberId) {
    throw new ValidationError(
      ADAPTER_NAMESPACE,
      `fromNumberId is required — pass it in options or set ${ENV.FROM_NUMBER_ID} in the environment.`,
    );
  }

  return {
    apiKey,
    fromNumberId,
    webhookSecret: options.webhookSecret ?? env[ENV.WEBHOOK_SECRET] ?? null,
    apiBaseUrl: options.apiBaseUrl ?? env[ENV.API_BASE_URL] ?? DEFAULT_API_BASE_URL,
    botName: options.botName ?? env[ENV.BOT_NAME] ?? DEFAULT_BOT_NAME,
    logger: options.logger ?? new ConsoleLogger("info").child(ADAPTER_NAMESPACE),
  };
}

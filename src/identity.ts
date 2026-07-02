// Version stamp read from package.json at load time so bumping the package
// bumps the User-Agent automatically. Kept in a dedicated module so tests
// and the runtime import the same constants.

import pkg from "../package.json" with { type: "json" };

const { name, version } = pkg as { name: string; version: string };

export const ADAPTER_NAME = name;
export const ADAPTER_VERSION = version;

// Free-form suffix Dial's request logs use to attribute traffic to Chat-SDK
// integrations. Not a Chat SDK spec today; if Vercel publishes a canonical
// marker later, this constant is the only place to change.
export const INTEGRATION_TAG = "chat-sdk";

export const USER_AGENT = `${ADAPTER_NAME}/${ADAPTER_VERSION} (${INTEGRATION_TAG})`;

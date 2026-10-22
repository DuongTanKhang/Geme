import "dotenv/config";
import { shopeeSafeConfig } from "./shopee.client.js";

const config = shopeeSafeConfig();
console.log(JSON.stringify({
  enabled: config.enabled,
  configurationStatus: config.configurationStatus,
  environment: config.environment,
  configured: config.configured,
  missing: config.missing,
  invalid: config.invalid,
  redirectUri: config.redirectUri,
}, null, 2));

if (!config.configured) process.exitCode = 1;

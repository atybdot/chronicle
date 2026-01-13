import pc from "picocolors";
import { telemetry, TELEMETRY_ENV_VAR } from "./telemetry";

/**
 * Show telemetry notice (opt-out model).
 * Telemetry is enabled by default, user can disable via environment variable.
 * Only shows the notice once (during first run or config init).
 */
export async function showTelemetryNotice(): Promise<void> {
  const disabledViaEnv =
    process.env[TELEMETRY_ENV_VAR]?.toLowerCase() === "false" ||
    process.env[TELEMETRY_ENV_VAR] === "0";

  if (disabledViaEnv) {
    return;
  }

  // Check if notice has already been shown
  const alreadyShown = await telemetry.hasNoticeBeenShown();
  if (alreadyShown) {
    return;
  }

  console.log(
    pc.dim(
      `\n📊 Chronicle collects anonymous telemetry to improve the project.\n` +
        `   Set ${pc.cyan(TELEMETRY_ENV_VAR + "=false")} to opt-out.\n` +
        `   See: ${pc.underline("https://chronicle.atyb.me/telemetry")}\n`,
    ),
  );

  // Mark the notice as shown
  await telemetry.markNoticeShown();
}

/**
 * Show telemetry status
 */
export async function showTelemetryStatus(): Promise<void> {
  const enabled = await telemetry.isEnabled();
  const anonymousId = await telemetry.getAnonymousId();
  const optedOut = await telemetry.hasOptedOut();
  const envDisabled =
    process.env[TELEMETRY_ENV_VAR]?.toLowerCase() === "false" ||
    process.env[TELEMETRY_ENV_VAR] === "0";

  console.log(pc.bold("\n📊 Telemetry Status\n"));

  if (envDisabled) {
    console.log(`  Status: ${pc.yellow("Disabled via environment variable")}`);
    console.log(`  Variable: ${pc.cyan(TELEMETRY_ENV_VAR + "=false")}`);
  } else if (optedOut) {
    console.log(`  Status: ${pc.yellow("Opted out")}`);
    console.log(`  Anonymous ID: ${pc.dim(anonymousId ?? "unknown")}`);
  } else if (enabled) {
    console.log(`  Status: ${pc.green("Enabled")}`);
    console.log(`  Anonymous ID: ${pc.dim(anonymousId ?? "unknown")}`);
  } else {
    console.log(`  Status: ${pc.yellow("Disabled")}`);
  }

  console.log();
  console.log(pc.dim("To opt-out permanently:"));
  console.log(`  ${pc.cyan("export " + TELEMETRY_ENV_VAR + "=false")}`);
  console.log();
}

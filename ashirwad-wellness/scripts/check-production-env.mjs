#!/usr/bin/env node
/**
 * Production readiness gate.
 *
 * Run before deploying, and in CI on the deploy branch:
 *
 *   npm run check:env
 *
 * Exits non-zero if the environment is not fit to accept a real customer's
 * order. The point is that a half-configured pharmacy fails here — visibly, on
 * a developer's terminal — rather than quietly serving a storefront that shows
 * "Not configured" where its drug licence number should be.
 */
import "dotenv/config";

// The check itself lives in src/lib/preflight.ts so this script and the running
// application cannot drift apart. That module deliberately has no imports and
// no framework dependencies, so Node's built-in type stripping (22.18+) runs it
// directly — no build step, no second copy of the rules.
const { checkProductionReadiness, isReady } = await import("../src/lib/preflight.ts");

const findings = checkProductionReadiness(process.env);
const blockers = findings.filter((f) => f.level === "blocker");
const warnings = findings.filter((f) => f.level === "warning");

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

console.log("\nAshirwad Wellness — production readiness\n");

for (const f of blockers) {
  console.log(`${RED}  BLOCK${RESET}  ${f.key}\n         ${DIM}${f.message}${RESET}`);
}
for (const f of warnings) {
  console.log(`${YELLOW}  WARN ${RESET}  ${f.key}\n         ${DIM}${f.message}${RESET}`);
}

console.log("");

if (!isReady(findings)) {
  console.log(
    `${RED}Not ready to accept orders.${RESET} ` +
      `${blockers.length} blocker(s), ${warnings.length} warning(s).\n\n` +
      `${DIM}Every blocker above is either a statutory identifier that must be\n` +
      `Ashirwad Medical's real registered value, or a safety rail that must not\n` +
      `ship switched off. None of them can be filled in by guesswork.${RESET}\n`,
  );
  process.exit(1);
}

console.log(
  `${GREEN}Ready to accept orders.${RESET} ${warnings.length} warning(s).\n`,
);

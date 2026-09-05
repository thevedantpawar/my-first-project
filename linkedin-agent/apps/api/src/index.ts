import { getConfig, loadEnvFile, providerReadiness } from './config.js';
import { logger } from './lib/logger.js';
import { toSanitizedError } from './lib/errors.js';
import { createApp } from './app.js';
import { verifyLinkedInToken } from './providers/linkedin.js';
import { WeekdayScheduler } from './scheduler/weekday-scheduler.js';

loadEnvFile();

function main(): void {
  let config;
  try {
    config = getConfig();
  } catch (error) {
    // A bad .env should stop the process with a readable message, not a stack.
    logger.error('Configuration error', { msg: toSanitizedError(error).message });
    process.exitCode = 1;
    return;
  }

  const readiness = providerReadiness(config);
  const scheduler = new WeekdayScheduler();
  const app = createApp(scheduler);

  const server = app.listen(config.PORT, () => {
    logger.info('LinkedIn content agent API listening', {
      port: config.PORT,
      env: config.NODE_ENV,
      platform: 'linkedin_only',
      dryRun: config.SOCIAL_CONTENT_DRY_RUN,
      providers: readiness,
    });
    for (const [provider, ready] of Object.entries(readiness)) {
      if (!ready) logger.warn(`Provider not configured: ${provider}`);
    }
    scheduler.start();

    // Check the member token once at boot. An expired token is the most likely
    // failure mode, and this surfaces it now instead of at 21:00.
    if (readiness.linkedin) {
      void verifyLinkedInToken().then((check) => {
        if (check.valid && check.urnMatches) {
          logger.info('LinkedIn token verified', { member: check.name, httpStatus: check.httpStatus });
        } else if (check.valid) {
          logger.warn('LinkedIn token is valid but LINKEDIN_PERSON_URN does not match the token owner', {
            configuredUrn: check.configuredUrn,
            derivedUrn: check.derivedUrn,
          });
        } else {
          logger.error('LinkedIn token check failed', {
            httpStatus: check.httpStatus,
            msg: check.error ?? 'unknown',
          });
        }
      });
    }
  });

  const shutdown = (signal: string): void => {
    logger.info('Shutting down', { signal });
    scheduler.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();

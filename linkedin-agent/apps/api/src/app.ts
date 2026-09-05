import cors from 'cors';
import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { toSanitizedError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { createRouter } from './routes/index.js';
import type { WeekdayScheduler } from './scheduler/weekday-scheduler.js';

export function createApp(scheduler: WeekdayScheduler | null = null): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(createRouter(scheduler));

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint.' } });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const sanitized = toSanitizedError(error);
    logger.error('Unhandled request error', { code: sanitized.code, msg: sanitized.message });
    res.status(500).json({ error: sanitized });
  });

  return app;
}

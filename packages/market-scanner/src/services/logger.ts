/**
 * @agoraiq/signal-engine — Logger
 */

import winston from "winston";
import { config } from "../config";

export const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "signal-engine" },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...rest }) => {
          const extra = Object.keys(rest).length > 1
            ? ` ${JSON.stringify(rest)}`
            : "";
          return `${timestamp} [${level}] ${message}${extra}`;
        })
      ),
    }),
  ],
});

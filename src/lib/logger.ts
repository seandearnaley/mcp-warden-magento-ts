import winston from "winston";
import * as path from "node:path";
import * as fs from "node:fs";

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: "red",
  warn: "yellow",
  info: "green",
  http: "magenta",
  debug: "white",
};

// Tell winston that you want to link the colors
winston.addColors(colors);

// Define which level to log based on environment
const level = () => {
  const env = process.env.NODE_ENV ?? "development";
  const isDevelopment = env === "development";
  return isDevelopment ? "debug" : "warn";
};

// Define format for file output (JSON for structured logging)
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Define transports
const transports: winston.transport[] = [];

// Determine stdio mode (when running under MCP transport, we must not log to console)
const isStdioMode = (process.env.MCP_STDIO_MODE ?? "").toLowerCase() === "true";

// Console transport is disabled by default to protect MCP stdio.
// Opt-in via LOG_TO_CONSOLE=true when debugging locally.
if (
  !isStdioMode &&
  process.env.NODE_ENV !== "production" &&
  (process.env.LOG_TO_CONSOLE ?? "").toLowerCase() === "true"
) {
  transports.push(
    new winston.transports.Console({
      level: level(),
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.timestamp(),
        winston.format.printf(({ level, message, timestamp, context }) => {
          const ctx = context ? `[${typeof context === "string" ? context : JSON.stringify(context)}] ` : "";
          return `${timestamp as string} ${level}: ${ctx}${String(message)}`;
        })
      ),
    })
  );
}

// File transports in production or when explicitly requested
const enableFileLogging =
  process.env.NODE_ENV === "production" || (process.env.LOG_TO_FILE ?? "").toLowerCase() === "true";
if (enableFileLogging) {
  const logDir = process.env.LOG_DIR ?? path.join(process.cwd(), "logs");
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    // ignore directory create errors; file transport will throw if it cannot write
  }

  const logFile = path.join(logDir, "mcp-warden-magento.log");
  transports.push(
    new winston.transports.File({
      filename: logFile,
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );

  // Separate error log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, "mcp-warden-magento-error.log"),
      level: "error",
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
}

// Create the logger
export const logger = winston.createLogger({
  level: level(),
  levels,
  transports,
  exitOnError: false,
});

// Create a child logger with context
export function createLogger(context: string) {
  return logger.child({ context });
}

// Export default logger instance
export default logger;

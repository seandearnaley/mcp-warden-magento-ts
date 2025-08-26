import winston from "winston";
import * as path from "node:path";

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

// Define format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss:ms" }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => `${String(info.timestamp)} ${String(info.level)}: ${String(info.message)}`)
);

// Define format for file output (JSON for structured logging)
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Define transports
const transports: winston.transport[] = [
  // Console transport
  new winston.transports.Console({
    format: consoleFormat,
  }),
];

// Add file transport in production or when LOG_TO_FILE is set
if (process.env.NODE_ENV === "production" || process.env.LOG_TO_FILE === "true") {
  const logDir = process.env.LOG_DIR ?? path.join(process.cwd(), "logs");
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

const winston = require("winston");
require("winston-daily-rotate-file");
const path = require("path");

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Define log format for console (human-readable)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, "../../logs");

// Transport for error logs (daily rotation)
const errorFileTransport = new winston.transports.DailyRotateFile({
  filename: path.join(logsDir, "error-%DATE%.log"),
  datePattern: "YYYY-MM-DD",
  level: "error",
  maxFiles: "14d", // Keep logs for 14 days
  maxSize: "20m", // Max file size 20MB
  format: logFormat,
});

// Transport for combined logs (daily rotation)
const combinedFileTransport = new winston.transports.DailyRotateFile({
  filename: path.join(logsDir, "combined-%DATE%.log"),
  datePattern: "YYYY-MM-DD",
  maxFiles: "14d",
  maxSize: "20m",
  format: logFormat,
});

// Transport for warning logs (daily rotation)
const warnFileTransport = new winston.transports.DailyRotateFile({
  filename: path.join(logsDir, "warn-%DATE%.log"),
  datePattern: "YYYY-MM-DD",
  level: "warn",
  maxFiles: "7d",
  maxSize: "20m",
  format: logFormat,
});

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: logFormat,
  transports: [errorFileTransport, combinedFileTransport, warnFileTransport],
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.DailyRotateFile({
      filename: path.join(logsDir, "exceptions-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      maxFiles: "14d",
      maxSize: "20m",
    }),
  ],
  // Handle unhandled promise rejections
  rejectionHandlers: [
    new winston.transports.DailyRotateFile({
      filename: path.join(logsDir, "rejections-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      maxFiles: "14d",
      maxSize: "20m",
    }),
  ],
});

// Add console transport for development (but not during tests)
if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
} else if (process.env.NODE_ENV === "production") {
  // In production, also log to console but with less verbose format
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    })
  );
}
// In test environment, don't add console transport - logs go to files only

// Create a stream object for Morgan (HTTP request logging)
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  },
};

// Helper methods for common logging patterns
logger.logRequest = (req, statusCode, responseTime) => {
  logger.info("HTTP Request", {
    method: req.method,
    url: req.originalUrl,
    statusCode,
    responseTime: `${responseTime}ms`,
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });
};

logger.logError = (error, context = {}) => {
  logger.error(error.message, {
    stack: error.stack,
    ...context,
  });
};

logger.logAuth = (action, userId, success, details = {}) => {
  logger.info("Auth Event", {
    action,
    userId,
    success,
    ...details,
  });
};

logger.logOrder = (action, orderId, details = {}) => {
  logger.info("Order Event", {
    action,
    orderId,
    ...details,
  });
};

logger.logDelivery = (action, orderId, agentId, details = {}) => {
  logger.info("Delivery Event", {
    action,
    orderId,
    agentId,
    ...details,
  });
};

module.exports = logger;

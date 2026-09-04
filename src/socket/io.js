const { Server } = require("socket.io");
const logger = require("@util/logger");
const { allowedOrigins } = require("@lib/http/createApp");
const { socketAuth } = require("./middleware");
const registerHandlers = require("./handlers");
const { bridgeBus } = require("./bridge");

let io = null;

/**
 * Attach Socket.IO to an existing http.Server (shared by server.js and src/socket/index.js).
 */
function attach(httpServer, { path = "/socket.io" } = {}) {
  if (io) return io;
  io = new Server(httpServer, {
    path,
    cors: {
      origin: (origin, cb) => {
        if (!origin || allowedOrigins().includes(origin) || process.env.SOCKET_CORS_ANY === "1") return cb(null, true);
        return cb(new Error("Not allowed by CORS"));
      },
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 20000,
  });
  io.use(socketAuth);
  io.on("connection", (socket) => registerHandlers(io, socket));
  bridgeBus(io);
  logger.info(`Socket.IO attached (path ${path})`);
  return io;
}

function getIO() {
  return io;
}

module.exports = { attach, getIO };

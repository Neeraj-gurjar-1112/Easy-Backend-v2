const { addAdminClient } = require("@events/orderEvents");

class StreamController {
  // Admin SSE stream for real-time order updates
  stream(req, res) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    addAdminClient(res);

    // Keep alive initial ping
    res.write(":connected\n\n");

    req.on("close", () => {
      res.end();
    });
  }
}

module.exports = new StreamController();

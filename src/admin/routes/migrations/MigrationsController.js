const path = require("path");
const { spawn } = require("child_process");
const { ROOT } = require("@lib/config/env");
const { Seller, Order, UserAddress } = require("@models");
const {
  missingSeller,
  missingAddr,
  missingOrderAddr,
} = require("../../util/helpers");

// ---------------- Migrations / Backfill Tools ----------------
// Simple in-memory progress tracking for backfill script run via child process
let backfillJob = {
  running: false,
  pid: null,
  phase: "idle", // sellers | addresses | done | error | idle
  total: null, // estimated total records to process
  scanned: 0,
  updated: 0,
  startedAt: null,
  endedAt: null,
  exitCode: null,
  logs: [],
  error: null,
};

function _appendLog(line) {
  try {
    backfillJob.logs.push(line);
    if (backfillJob.logs.length > 200) backfillJob.logs.shift();
    // very rough phase detection
    if (/Backfill Summary/i.test(line)) backfillJob.phase = "done";
    // progress heuristics: count success and failures as scanned
    if (/^✅ /.test(line) || /^⚠️/.test(line) || /^❌/.test(line)) {
      backfillJob.scanned++;
      if (/^✅ /.test(line)) backfillJob.updated++;
    }
  } catch (_) {}
}

class MigrationsController {
  async start(req, res) {
    try {
      if (backfillJob.running) {
        return res.status(409).json({ error: "backfill already running" });
      }
      const { limit, preferPlaceDetails } = req.body || {};

      // Estimate totals upfront (best effort)
      const [sellersToFix, addrsToFix, ordersToFix] = await Promise.all([
        Seller.countDocuments(missingSeller),
        UserAddress.countDocuments(missingAddr),
        Order.countDocuments(missingOrderAddr),
      ]);

      backfillJob = {
        running: true,
        pid: null,
        phase: "sellers",
        total: sellersToFix + addrsToFix + ordersToFix,
        scanned: 0,
        updated: 0,
        startedAt: new Date(),
        endedAt: null,
        exitCode: null,
        logs: [],
        error: null,
      };

      // Legacy resolved the backend root via __dirname; the v2 layout uses ROOT from @lib/config/env.
      const backendDir = ROOT;
      const nodeExec = process.execPath; // current Node
      const scriptPath = path.join(ROOT, "scripts", "backfill_locations.js");
      const env = { ...process.env };
      if (typeof limit !== "undefined") env.BACKFILL_LIMIT = String(limit);
      if (preferPlaceDetails === false) env.PREFER_PLACE_DETAILS = "0";

      const child = spawn(nodeExec, [scriptPath], { cwd: backendDir, env });
      backfillJob.pid = child.pid;

      child.stdout.on("data", (buf) => {
        const text = buf.toString();
        text.split(/\r?\n/).forEach((line) => {
          if (!line) return;
          _appendLog(line);
        });
      });
      child.stderr.on("data", (buf) => {
        const text = buf.toString();
        text.split(/\r?\n/).forEach((line) => {
          if (!line) return;
          _appendLog(`[err] ${line}`);
        });
      });
      child.on("exit", (code) => {
        backfillJob.exitCode = code;
        backfillJob.endedAt = new Date();
        backfillJob.running = false;
        backfillJob.phase = code === 0 ? "done" : "error";
      });

      res.json({ ok: true, pid: child.pid, total: backfillJob.total });
    } catch (e) {
      console.error("start backfill error", e);
      backfillJob.running = false;
      backfillJob.phase = "error";
      backfillJob.error = e?.message || String(e);
      backfillJob.endedAt = new Date();
      return res.status(500).json({ error: "failed to start backfill" });
    }
  }

  progress(req, res) {
    const { logs, ...rest } = backfillJob;
    res.json({ ...rest, logs: logs.slice(-50) });
  }

  // Preview count: how many seller/user addresses missing coords (without starting job)
  async previewCount(req, res) {
    try {
      const [sellersToFix, addrsToFix, ordersToFix] = await Promise.all([
        Seller.countDocuments(missingSeller),
        UserAddress.countDocuments(missingAddr),
        Order.countDocuments(missingOrderAddr),
      ]);
      res.json({
        sellers_missing: sellersToFix,
        addresses_missing: addrsToFix,
        orders_missing: ordersToFix,
        total_missing: sellersToFix + addrsToFix + ordersToFix,
      });
    } catch (e) {
      res.status(500).json({ error: "failed to compute preview counts" });
    }
  }

  stream(req, res) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const interval = setInterval(() => {
      res.write(`data: ${JSON.stringify(backfillJob)}\n\n`);
      if (backfillJob.phase === "done" || backfillJob.phase === "error") {
        clearInterval(interval);
        res.write(`data: ${JSON.stringify(backfillJob)}\n\n`);
        res.end();
      }
    }, 1000);
    req.on("close", () => clearInterval(interval));
  }

  stop(req, res) {
    try {
      if (!backfillJob.running || !backfillJob.pid) {
        return res.status(400).json({ error: "no running job" });
      }
      process.kill(backfillJob.pid);
      backfillJob.running = false;
      backfillJob.phase = "error";
      backfillJob.error = "terminated";
      backfillJob.endedAt = new Date();
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: "failed to stop job" });
    }
  }
}

module.exports = new MigrationsController();

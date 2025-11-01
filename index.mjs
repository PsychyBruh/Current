import cluster from "cluster";
import os from "os";
import net from "net";
import fs from "fs";
import path from "path";
import { createServer } from "http";
import express from "express";
import compression from "compression";
import helmet from "helmet";
import rateLimit from 'express-rate-limit';
import { LRUCache } from "lru-cache";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import pino from "pino";

dotenv.config();
const PORT = parseInt(process.env.PORT || "3000", 10);
const NODE_ENV = process.env.NODE_ENV || 'development';
const packageJsonPath = path.resolve("package.json");

const logger = pino({
  level: NODE_ENV === 'production' ? 'info' : 'debug',
});

function logInfo(msg) { logger.info(msg); }
function logSuccess(msg) { logger.info(msg); }
function logError(err) {
  const message = err instanceof Error ? err.stack || err.message : err;
  logger.error(message);
}

process.on("uncaughtException", err => logError(`Unhandled Exception: ${err}`));
process.on("unhandledRejection", reason => logError(`Unhandled Rejection: ${reason}`));

if (global.gc) {
  setInterval(() => {
    const { heapUsed, heapTotal } = process.memoryUsage();
    if (heapTotal > 0 && heapUsed / heapTotal > 0.8) global.gc();
  }, 120000);
}

if (cluster.isPrimary) {
  logInfo(`Primary process ${process.pid} is running in ${NODE_ENV} mode`);

  const numWorkers = parseInt(process.env.WORKERS, 10) || Math.max(1, Math.floor(os.cpus().length / 2));
  logInfo(`Forking ${numWorkers} workers for ${os.cpus().length} total cores...`);

  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker, code, signal) => {
    if (worker.exitedAfterDisconnect) {
      logInfo(`Worker ${worker.process.pid} disconnected successfully`);
      return;
    }
    logError(`Worker ${worker.process.pid} exited unexpectedly (code: ${code}, signal: ${signal}). Forking a new one...`);
    cluster.fork();
  });

  let currentWorkerIndex = 0;
  const server = net.createServer({ pauseOnConnect: true }, (connection) => {
    const workersArr = Object.values(cluster.workers);
    if (!workersArr.length) {
      connection.destroy();
      return;
    }
    const worker = workersArr[currentWorkerIndex++ % workersArr.length];
    worker.send("sticky-session:connection", connection);
  });

  server.on("error", err => logError(`Master server error: ${err}`));
  server.listen(PORT, () => logSuccess(`Master server listening on port ${PORT}`));

  let lastVersion = null;

  async function reloadWorkers() {
    const oldWorkers = Object.values(cluster.workers);
    if (oldWorkers.length === 0) return logInfo("No workers to reload.");

    logInfo(`Starting parallel reload for ${oldWorkers.length} workers...`);

    const newWorkerPromises = oldWorkers.map(() =>
      new Promise(resolve => {
        const newWorker = cluster.fork();
        newWorker.once("listening", () => resolve(newWorker));
      })
    );

    const newWorkers = await Promise.all(newWorkerPromises);
    logSuccess(`All ${newWorkers.length} new workers are ready. Phasing out old workers...`);
    
    for (const oldWorker of oldWorkers) {
      logInfo(`Disconnecting old worker ${oldWorker.process.pid}...`);
      oldWorker.disconnect();
    }
    
    logSuccess("Reload complete. New workers are active");
  }

  function checkVersion() {
    fs.readFile(packageJsonPath, "utf8", (err, data) => {
      if (err) return logError(`Failed to read package.json: ${err.message}`);
      try {
        const { version } = JSON.parse(data);
        if (lastVersion && lastVersion !== version) {
          logInfo(`Version updated from ${lastVersion} to ${version}. Triggering reload`);
          reloadWorkers().catch(logError);
        }
        lastVersion = version;
      } catch (parseError) {
        logError(`Failed to parse package.json: ${parseError.message}`);
      }
    });
  }

  try {
    const data = fs.readFileSync(packageJsonPath, "utf8");
    lastVersion = JSON.parse(data).version;
    logInfo(`Initial version loaded: ${lastVersion}`);
  } catch (e) {
    logError(`Failed to read initial version: ${e.message}`);
  }

  setInterval(checkVersion, 5000);

} else {
  
  const __dirname = process.cwd();
  const srcPath = path.join(__dirname, NODE_ENV === 'production' ? 'dist' : 'src');
  const publicPath = path.join(__dirname, "public");

  const app = express();
  const server = createServer(app);
  
  const pageCache = new LRUCache({ max: 25000, ttl: 1000 * 60 * 60 });
  const suggestionsCache = new LRUCache({ max: 50000, ttl: 1000 * 60 * 60 });
  
  app.use(helmet({
    contentSecurityPolicy: false, 
    crossOriginEmbedderPolicy: false,
    frameguard: false
  }));

  app.use(compression({
    level: 6,
    threshold: '1kb', 
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    }
  }));

  app.use((req, res, next) => {
    if (req.path.endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
    next();
  });
  
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    const key = req.originalUrl;
    const val = pageCache.get(key);
    if (val) {
      res.setHeader("X-Cache", "HIT");
      return res.send(val);
    }
    const originalSend = res.send;
    res.send = (body) => {
      if (res.statusCode === 200) {
        pageCache.set(key, body);
        res.setHeader("X-Cache", "MISS");
      }
      originalSend.call(res, body);
    };
    next();
  });
  
  const staticOpts = { maxAge: "7d", immutable: true, etag: false };
  app.use("/baremux/", express.static(baremuxPath, staticOpts));
  app.use("/epoxy/", express.static(epoxyPath, staticOpts));
  app.use("/libcurl/", express.static(libcurlPath, staticOpts));
  app.use("/u/", express.static(uvPath, staticOpts));
  app.use("/s/", express.static(path.join(__dirname, "scramjet")));
  app.use("/assets/data", express.static(path.join(publicPath, "assets", "data"), { maxAge: 0, immutable: false, etag: true }));
  app.use("/assets", express.static(path.join(publicPath, "assets"), staticOpts));
  // Serve a patched version of serser.js that strips external ad injection entirely
  app.get("/b/u/serser.js", (req, res) => {
    try {
      const filePath = path.join(publicPath, "b", "u", "serser.js");
      let code = fs.readFileSync(filePath, "utf8");
      // Remove the injection call that appends the external main.js script before </body>
      code = code.replace(/A=A\.replace\(\s*\/<\\\/body>\/i,\s*'[^']*cdn\.usewaves\.site\/main\.js[^']*'\s*\);\s*/g, "");
      res.setHeader("Content-Type", "application/javascript");
      return res.send(code);
    } catch (e) {
      res.setHeader("Content-Type", "application/javascript");
      return res.status(200).send("/* ads removal failed, serving original */\n" + fs.readFileSync(path.join(publicPath, "b", "u", "serser.js"), "utf8"));
    }
  });
  app.use("/b", express.static(path.join(publicPath, "b")));
  app.use(express.static(srcPath, staticOpts));

  const bMap = {
    "1": path.join(baremuxPath, "index.js"),
    "2": path.join(publicPath, "b/s/scramjet.all.js"),
    "3": path.join(publicPath, "b/u/bunbun.js"),
    "4": path.join(publicPath, "b/u/concon.js")
  };

  app.get("/b", (req, res) => {
    const id = req.query.id;
    bMap[id] ? res.sendFile(bMap[id]) : res.status(404).send("// not found");
  });

  const apiLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later!' }
  });

  app.get("/api/version", (_req, res) => {
    fs.readFile(packageJsonPath, "utf8", (err, data) => {
      if (err) return res.status(500).json({ error: "Unable to check version" });
      try {
        res.json({ version: JSON.parse(data).version });
      } catch {
        res.status(500).json({ error: "Invalid package.json file" });
      }
    });
  });

  app.get("/api/suggestions", apiLimiter, async (req, res) => {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Query parameter "q" is required' });

    const cachedData = suggestionsCache.get(q);
    if (cachedData) {
      return res.setHeader("X-Cache", "HIT").json(cachedData);
    }
    
    try {
      const response = await fetch(`https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&format=json`);
      const data = await response.json();
      suggestionsCache.set(q, data);
      res.setHeader("X-Cache", "MISS").json(data);
    } catch (error) {
      logError(`Suggestion fetch failed: ${error.message}`);
      res.status(500).json([]);
    }
  });

  app.get("/", (_req, res) => res.sendFile(path.join(srcPath, "index.html")));
  app.use((_req, res) => res.status(404).sendFile(path.join(srcPath, "404.html")));
  
  server.keepAliveTimeout = 5000;
  server.headersTimeout = 10000;

  server.on("error", err => logError(`Worker error: ${err}`));
  server.listen(0, () => {
    logSuccess(`Worker started and ready!`);
    if (process.send) process.send('listening');
  });
  
  process.on("message", (msg, conn) => {
    if (msg === "sticky-session:connection" && conn) {
      server.emit("connection", conn);
      conn.resume();
    }
    if (msg?.cmd === "clear-cache") {
      pageCache.clear();
      suggestionsCache.clear();
      logInfo(`Worker ${process.pid} cache cleared due to version update`);
    } 
  });
}

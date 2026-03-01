import "dotenv/config";
import { WebcastPushConnection } from "tiktok-live-connector";
import Rcon from "rcon";
import fs from "fs";
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- ENV ----------
const RCON_HOST = process.env.RCON_HOST || "127.0.0.1";
const RCON_PORT = parseInt(process.env.RCON_PORT || "25575", 10);
const RCON_PASSWORD = process.env.RCON_PASSWORD || "";
const QUEUE_CONCURRENCY = parseInt(process.env.QUEUE_CONCURRENCY || "1", 10);
const GLOBAL_COOLDOWN_MS = parseInt(
  process.env.GLOBAL_COOLDOWN_MS || "1000",
  10,
);
const RECONNECT_DELAY_MS = parseInt(
  process.env.RECONNECT_DELAY_MS || "5000",
  10,
);
// Support multiple API keys (comma-separated) for rate-limit distribution
const EULERSTREAM_API_KEYS = (process.env.EULERSTREAM_API_KEY || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);
let nextKeyIndex = 0;

function getNextApiKey() {
  if (EULERSTREAM_API_KEYS.length === 0) return undefined;
  const key = EULERSTREAM_API_KEYS[nextKeyIndex % EULERSTREAM_API_KEYS.length];
  nextKeyIndex++;
  return key;
}

console.log(`🔑 Loaded ${EULERSTREAM_API_KEYS.length} API key(s)`);

// ---------- Load gift map ----------
let giftMap = {};
try {
  giftMap = JSON.parse(
    fs.readFileSync(new URL("../gifts.json", import.meta.url)),
  );
  console.log("✅ Loaded gifts.json");
} catch (e) {
  console.warn("⚠️ Cannot load gifts.json, using empty map");
  giftMap = {};
}

// ---------- Load Seen Gifts ----------
let seenGifts = {};
try {
  seenGifts = JSON.parse(
    fs.readFileSync(new URL("../seen_gifts.json", import.meta.url)),
  );
} catch (e) {
  seenGifts = {};
}

function saveSeenGifts() {
  try {
    fs.writeFileSync(
      new URL("../seen_gifts.json", import.meta.url),
      JSON.stringify(seenGifts, null, 2),
    );
  } catch (e) {
    console.error("❌ Error saving seen_gifts.json:", e);
  }
}

// ---------- RCON ----------
let rcon;
function connectRcon() {
  return new Promise((resolve, reject) => {
    rcon = new Rcon(RCON_HOST, RCON_PORT, RCON_PASSWORD);
    rcon.on("connect", () => {
      console.log(`✅ RCON connected ${RCON_HOST}:${RCON_PORT}`);
      resolve();
    });
    rcon.on("end", () => {
      console.warn("⚠️ RCON disconnected, retrying in 5s...");
      setTimeout(connectRcon, 5000);
    });
    rcon.on("error", (err) => {
      console.error("❌ RCON error:", err?.message || err);
    });
    rcon.connect();
  });
}

async function sendCmd(cmd) {
  return new Promise((resolve, reject) => {
    try {
      rcon.send(cmd);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

// ---------- Simple queue ----------
const queue = [];
let running = 0;
let lastRun = 0;

async function pump() {
  if (running >= QUEUE_CONCURRENCY) return;
  const item = queue.shift();
  if (!item) return;
  running++;
  const delta = Date.now() - lastRun;
  if (delta < GLOBAL_COOLDOWN_MS) {
    await new Promise((r) => setTimeout(r, GLOBAL_COOLDOWN_MS - delta));
  }
  try {
    await item();
  } catch (e) {
    console.error("❌ Task error:", e);
  } finally {
    lastRun = Date.now();
    running--;
    setImmediate(pump);
  }
}

function enqueue(task) {
  queue.push(task);
  setImmediate(pump);
}

// ==========================================================
//  SESSION SYSTEM — Multiple TikTok Users × Multiple Players
// ==========================================================

// Session shape (persisted in sessions.json):
//   { id, tiktokUsername, playerName, active }
//
// Runtime-only additions:
//   connection   — WebcastPushConnection instance
//   reconnectTimer — setTimeout handle for auto-reconnect

const sessions = new Map(); // id → session object

function sessionsFilePath() {
  return new URL("../sessions.json", import.meta.url);
}

function loadSessions() {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionsFilePath()));
    for (const s of raw) {
      sessions.set(s.id, { ...s, connection: null, reconnectTimer: null });
    }
    console.log(`✅ Loaded ${sessions.size} session(s) from sessions.json`);
  } catch (e) {
    console.warn("⚠️ Cannot load sessions.json, starting empty");
  }
}

function saveSessions() {
  try {
    const data = [...sessions.values()].map(
      ({ id, tiktokUsername, playerName, active }) => ({
        id,
        tiktokUsername,
        playerName,
        active,
      }),
    );
    fs.writeFileSync(sessionsFilePath(), JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("❌ Error saving sessions.json:", e);
  }
}

// ---------- Gift handler (shared logic) ----------
function handleGift(data, playerName) {
  const name = data.giftName || "Unknown";

  // Save or update seen gift
  seenGifts[name] = {
    id: data.giftId,
    name: name,
    icon: data.giftPictureUrl || seenGifts[name]?.icon || "",
    diamondCount: data.diamondCount || seenGifts[name]?.diamondCount || 0,
  };
  saveSeenGifts();

  // รองรับตำแหน่งฟิลด์ต่างเวอร์ชัน
  const giftType = data.giftType ?? data.gift?.giftType;
  const isStreakable = giftType === 1;

  const repeatEnd = data.repeatEnd ?? data.gift?.repeatEnd;
  const repeatCount = data.repeatCount ?? data.gift?.repeatCount ?? 1;

  // ของขวัญที่สตรีค: ระหว่างสตรีคยังไม่ยิงคำสั่ง รอจนจบสตรีคก่อน
  if (isStreakable && repeatEnd === false) {
    return;
  }

  const diamondsPerGift = data.diamondCount ?? 0;

  console.log(
    `🎁 [${playerName}] ${data.uniqueId} sent ${name} (diamonds:${diamondsPerGift}) streakCount:${repeatCount}, repeatEnd:${repeatEnd ?? "n/a"}`,
  );

  // 1. หา Key จริงๆ ที่อยู่ใน map โดยไม่สนตัวพิมพ์เล็กใหญ่
  const matchKey = Object.keys(giftMap).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );

  // 2. ดึงข้อมูลโดยใช้ Key ที่เจอ (หรือ undefined ถ้าไม่เจอ)
  let giftConfig = matchKey ? giftMap[matchKey] : undefined;
  let commands = [];

  if (Array.isArray(giftConfig)) {
    commands = giftConfig;
  } else if (giftConfig && giftConfig.commands) {
    commands = giftConfig.commands;
  }

  // ถ้าไม่แมตช์ชื่อ ใช้ fallback ตามจำนวนเพชรต่อชิ้น
  if (!commands || commands.length === 0) {
    if (diamondsPerGift >= 200) commands = giftMap["DefaultLargeGift"];
    else if (diamondsPerGift >= 20) commands = giftMap["DefaultMediumGift"];
    else commands = giftMap["DefaultSmallGift"];

    // Handle object format for fallback
    if (commands && !Array.isArray(commands) && commands.commands) {
      commands = commands.commands;
    }
  }

  if (!commands || commands.length === 0) return;

  // Calculate total iterations based on streak and gift quantity
  const giftQuantity =
    giftConfig && !Array.isArray(giftConfig) && giftConfig.quantity
      ? giftConfig.quantity
      : 1;
  const times = (isStreakable ? Math.max(1, repeatCount) : 1) * giftQuantity;

  const senderName =
    data.nickname || data.sender?.nickname || "ผู้ส่งไม่ทราบชื่อ";

  const commandsOnce = commands.map((c) =>
    c
      .replaceAll("{count}", String(times))
      .replaceAll("{sender}", senderName)
      .replaceAll("{player}", playerName),
  );

  for (let i = 0; i < times; i++) {
    for (const cmd of commandsOnce) {
      enqueue(async () => {
        console.log(`↪︎ RCON [${playerName}]:`, cmd);
        await sendCmd(cmd);
      });
    }
  }

  console.log("💡 Gift commands enqueued");
}

// ---------- Per-session TikTok connection ----------
function createSessionConnection(session) {
  // Assign an API key to this session (round-robin)
  const apiKey = getNextApiKey();
  console.log(
    `🔑 [${session.tiktokUsername}] Using API key: ${apiKey ? apiKey.slice(0, 15) + "..." : "none"}`,
  );
  const conn = new WebcastPushConnection(session.tiktokUsername, {
    signApiKey: apiKey,
  });

  conn.on("gift", (data) => {
    if (!session.active) return;
    handleGift(data, session.playerName);
  });

  conn.on("disconnected", () => {
    console.warn(`⚠️ TikTok disconnected [${session.tiktokUsername}]`);
    if (session.active) {
      console.log(
        `⏳ Reconnecting [${session.tiktokUsername}] in ${RECONNECT_DELAY_MS}ms`,
      );
      session.reconnectTimer = setTimeout(
        () => connectSession(session),
        RECONNECT_DELAY_MS,
      );
    }
  });

  return conn;
}

async function connectSession(session) {
  if (!session.active) return;

  // Clear any pending reconnect timer
  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
  }

  try {
    // Create new connection if needed
    if (!session.connection) {
      session.connection = createSessionConnection(session);
    }
    const state = await session.connection.connect();
    console.log(
      `✅ [${session.tiktokUsername}] Connected to TikTok room: ${state.roomId} → Player: ${session.playerName}`,
    );
  } catch (e) {
    console.error(
      `❌ [${session.tiktokUsername}] TikTok connect error:`,
      e?.message || e,
    );
    if (session.active) {
      console.log(
        `⏳ [${session.tiktokUsername}] Reconnecting in ${RECONNECT_DELAY_MS}ms`,
      );
      session.reconnectTimer = setTimeout(
        () => connectSession(session),
        RECONNECT_DELAY_MS,
      );
    }
  }
}

function disconnectSession(session) {
  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
  }
  if (session.connection) {
    try {
      session.connection.disconnect();
    } catch (e) {
      // ignore
    }
    session.connection = null;
  }
}

async function startSession(session) {
  session.active = true;
  saveSessions();
  await connectSession(session);
}

function stopSession(session) {
  session.active = false;
  disconnectSession(session);
  saveSessions();
}

// ---------- Boot ----------
(async () => {
  loadSessions();

  console.log("🚀 TikTok ⇄ Minecraft bridge is starting...");

  // Connect RCON in background (don't block Express)
  connectRcon().then(() => {
    // Auto-start sessions after RCON is ready
    for (const session of sessions.values()) {
      if (session.active) {
        console.log(
          `🔄 Auto-starting session: ${session.tiktokUsername} → ${session.playerName}`,
        );
        connectSession(session);
      }
    }
  });

  // ---------- Express Server ----------
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Multer config
  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      const uploadDir = path.join(__dirname, "../public/uploads");
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
      cb(null, Date.now() + "-" + file.originalname);
    },
  });
  const upload = multer({ storage: storage });

  app.use(cors());
  app.use(express.json());
  app.use(express.static("public"));

  // ========== GIFT APIs ==========

  // API: Get all gifts
  app.get("/api/gifts", (req, res) => {
    res.json(giftMap);
  });

  // API: Get seen gifts
  app.get("/api/seen-gifts", (req, res) => {
    res.json(seenGifts);
  });

  // API: Upload image
  app.post("/api/upload", upload.single("image"), (req, res) => {
    console.log("📥 Received upload request");
    if (!req.file) {
      console.error("❌ No file uploaded in request");
      return res.status(400).json({ error: "No file uploaded" });
    }
    console.log(
      `✅ File uploaded: ${req.file.filename}, Size: ${req.file.size}`,
    );
    res.json({ url: `/uploads/${req.file.filename}` });
  });

  // API: Add or Update gift
  app.post("/api/gifts", (req, res) => {
    const { name, commands, originalName, description, rewardImage, type } =
      req.body;

    if (!name || !commands) {
      return res.status(400).json({ error: "Name and commands are required" });
    }

    // If editing and name changed, delete old entry
    if (originalName && originalName !== name) {
      delete giftMap[originalName];
    }

    // Save as object with metadata
    giftMap[name] = {
      commands: commands,
      description: description || "",
      rewardImage: rewardImage || "",
      type: type || "help",
      quantity: parseInt(req.body.quantity) || 1,
    };

    saveGifts();
    res.json({ success: true, giftMap });
  });

  // API: Delete gift
  app.delete("/api/gifts/:name", (req, res) => {
    const name = req.params.name;
    if (giftMap[name]) {
      delete giftMap[name];
      saveGifts();
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Gift not found" });
    }
  });

  // API: Test gift
  app.post("/api/test-gift", (req, res) => {
    const { name, sender, player } = req.body;
    let commands = [];
    const giftConfig = giftMap[name];

    if (Array.isArray(giftConfig)) {
      commands = giftConfig;
    } else if (giftConfig && giftConfig.commands) {
      commands = giftConfig.commands;
    }

    if (!commands || commands.length === 0) {
      return res.status(404).json({ error: "Gift not found" });
    }

    const senderName = sender || "TestUser";
    const playerName = player || "@p";
    const commandsOnce = commands.map((c) =>
      c
        .replaceAll("{count}", "1")
        .replaceAll("{sender}", senderName)
        .replaceAll("{player}", playerName),
    );

    // Enqueue commands
    for (const cmd of commandsOnce) {
      enqueue(async () => {
        console.log("↪︎ RCON (Test):", cmd);
        await sendCmd(cmd);
      });
    }

    res.json({
      success: true,
      message: `Executed ${commands.length} commands for player ${playerName}`,
    });
  });

  // ========== SESSION APIs ==========

  // API: Get all sessions
  app.get("/api/sessions", (req, res) => {
    const list = [...sessions.values()].map(
      ({ id, tiktokUsername, playerName, active }) => ({
        id,
        tiktokUsername,
        playerName,
        active,
      }),
    );
    res.json(list);
  });

  // API: Add new session
  app.post("/api/sessions", (req, res) => {
    const { tiktokUsername, playerName } = req.body;

    if (!tiktokUsername || !playerName) {
      return res
        .status(400)
        .json({ error: "tiktokUsername and playerName are required" });
    }

    const id = crypto.randomBytes(6).toString("hex");
    const session = {
      id,
      tiktokUsername: tiktokUsername.trim(),
      playerName: playerName.trim(),
      active: false,
      connection: null,
      reconnectTimer: null,
    };

    sessions.set(id, session);
    saveSessions();

    console.log(
      `➕ Session added: ${tiktokUsername} → ${playerName} (id: ${id})`,
    );
    res.json({
      success: true,
      session: {
        id,
        tiktokUsername: session.tiktokUsername,
        playerName: session.playerName,
        active: false,
      },
    });
  });

  // API: Update session
  app.put("/api/sessions/:id", (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const { tiktokUsername, playerName } = req.body;
    const wasActive = session.active;

    // Stop if running (connection details may change)
    if (wasActive) {
      stopSession(session);
    }

    if (tiktokUsername) session.tiktokUsername = tiktokUsername.trim();
    if (playerName) session.playerName = playerName.trim();

    // Need to recreate connection since username may have changed
    session.connection = null;

    saveSessions();

    // Restart if was active
    if (wasActive) {
      startSession(session);
    }

    console.log(
      `✏️ Session updated: ${session.tiktokUsername} → ${session.playerName}`,
    );
    res.json({
      success: true,
      session: {
        id: session.id,
        tiktokUsername: session.tiktokUsername,
        playerName: session.playerName,
        active: session.active,
      },
    });
  });

  // API: Delete session
  app.delete("/api/sessions/:id", (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    disconnectSession(session);
    sessions.delete(req.params.id);
    saveSessions();

    console.log(
      `🗑️ Session deleted: ${session.tiktokUsername} → ${session.playerName}`,
    );
    res.json({ success: true });
  });

  // API: Toggle session on/off
  app.post("/api/sessions/:id/toggle", async (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.active) {
      stopSession(session);
      console.log(`🔴 Session stopped: ${session.tiktokUsername}`);
    } else {
      await startSession(session);
      console.log(
        `🟢 Session started: ${session.tiktokUsername} → ${session.playerName}`,
      );
    }

    res.json({ success: true, active: session.active });
  });

  function saveGifts() {
    try {
      fs.writeFileSync(
        new URL("../gifts.json", import.meta.url),
        JSON.stringify(giftMap, null, 2),
      );
      console.log("💾 Saved gifts.json");
    } catch (e) {
      console.error("❌ Error saving gifts.json:", e);
    }
  }

  app.listen(PORT, () => {
    console.log(`🌐 Web interface running at http://localhost:${PORT}`);
  });
})();

/**
 * Clients controller (mount: /api/clients, every route behind verifyToken).
 * upsertClient / completeProfile are the legacy controllers/clientsController.js
 * verbatim; getMe / updateMe were inline handlers in the legacy routes/clients.js.
 */
const { Client } = require("@models");

// Upsert a client profile using JWT user ID (email removed from spec Oct 2025)
// Body: { name, first_name, last_name, dob, phone }
async function upsertClient(req, res) {
  try {
    // One-time lazy migration: drop legacy email index causing null duplicate conflicts
    if (!global.__CLIENT_EMAIL_INDEX_DROPPED) {
      try {
        const indexes = await Client.collection.indexes();
        const emailIdx = indexes.find((i) =>
          Array.isArray(i.key)
            ? false
            : Object.keys(i.key).length === 1 && i.key.email === 1
        );
        if (emailIdx) {
          await Client.collection.dropIndex("email_1").catch(() => {});
          console.warn("[clientsController] Dropped legacy email_1 index");
        }
        global.__CLIENT_EMAIL_INDEX_DROPPED = true;
      } catch (migrateErr) {
        // Ignore migration failure; will retry next request
      }
    }

    // The user ID comes from the JWT middleware
    const userId = req.user.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { name, first_name, last_name, dob, phone } = req.body || {};

    // If this is a brand new profile (no existing doc) require at least one identity field
    const existingDoc = await Client.findById(userId).lean();
    if (!existingDoc) {
      // Email removed from client logic (2025-10). Only require one of phone/name/first_name on first creation.
      if (!phone && !first_name && !name) {
        return res.status(400).json({
          message: "At least one of phone/name/first_name required",
        });
      }
    }

    // Uniqueness guards
    if (phone) {
      let existingPhone = await Client.findOne({
        phone,
        _id: { $ne: userId },
      }).lean();

      if (existingPhone) {
        console.warn(
          `[upsertClient] phone conflict phone=${phone} incomingUser=${userId} existingUser=${existingPhone._id}`
        );
        return res.status(409).json({ message: "phone_in_use" });
      }
    }

    const update = {};
    if (name) update.name = name; // legacy fallback
    if (first_name) update.first_name = first_name;
    if (last_name) update.last_name = last_name;
    if (dob) {
      const parsed = new Date(dob);
      if (!isNaN(parsed.getTime())) update.dob = parsed;
    }
    // Email ignored for clients (2025-10 spec change)
    if (phone) update.phone = phone;

    if (!update.name && update.first_name)
      update.name =
        update.first_name + (update.last_name ? " " + update.last_name : "");
    if (!update.name) update.name = "Anonymous"; // default name

    // Diagnostic: log update payload during development (exclude in production unless DEBUG_UPSERT=1)
    if (process.env.DEBUG_UPSERT === "1") {
      console.log("[upsertClient] update payload", update);
    }

    // Mark profile_completed if core fields present (first_name + phone + dob)
    if (
      update.first_name &&
      (existingDoc?.phone || update.phone) &&
      (update.dob || existingDoc?.dob)
    ) {
      update.profile_completed = true;
    }

    let client;
    try {
      client = await Client.findByIdAndUpdate(
        userId,
        { $setOnInsert: { created_at: new Date() }, $set: update },
        { upsert: true, new: true }
      ).lean();
    } catch (dbErr) {
      if (dbErr && dbErr.code === 11000) {
        if (dbErr.keyPattern?.phone)
          return res.status(409).json({ message: "phone_in_use" });
        throw dbErr;
      } else {
        throw dbErr;
      }
    }

    res.json({
      ok: true,
      client_id: client._id,
      profile: {
        name: client.name,
        first_name: client.first_name,
        last_name: client.last_name,
        dob: client.dob,
        phone: client.phone,
        profile_completed: client.profile_completed,
      },
    });
  } catch (err) {
    console.error("upsertClient error:", err);
    res.status(500).json({ message: err.message || "Failed to upsert client" });
  }
}

// Explicit profile completion endpoint (requires first_name + phone; dob now optional)
async function completeProfile(req, res) {
  try {
    const userId = req.user.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { first_name, last_name, dob, phone } = req.body || {};
    if (!first_name)
      return res.status(400).json({ message: "first_name required" });
    if (!phone) return res.status(400).json({ message: "phone required" });

    let parsedDob = null;
    if (dob) {
      parsedDob = new Date(dob);
      if (isNaN(parsedDob.getTime()))
        return res.status(400).json({ message: "dob invalid" });
    }

    const client = await Client.findByIdAndUpdate(
      userId,
      {
        $set: {
          first_name,
          last_name,
          ...(parsedDob ? { dob: parsedDob } : {}),
          phone,
          name: first_name + (last_name ? " " + last_name : ""),
          profile_completed: true,
        },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true, new: true }
    ).lean();

    res.json({
      client_id: client._id,
      profile: {
        name: client.name,
        first_name: client.first_name,
        last_name: client.last_name,
        dob: client.dob,
        phone: client.phone,
        profile_completed: client.profile_completed,
      },
    });
  } catch (e) {
    console.error("completeProfile error", e);
    res.status(500).json({ message: "Failed to complete profile" });
  }
}

// GET /me - Get user profile (was inline in legacy routes/clients.js)
async function getMe(req, res) {
  try {
    const userId = req.user.id;
    const client = await Client.findById(userId).lean();
    if (!client) return res.status(404).json({ message: "not found" });
    return res.json({
      name: client.name,
      client_id: client._id,
      first_name: client.first_name,
      last_name: client.last_name,
      phone: client.phone,
      profile_completed: client.profile_completed,
    });
  } catch (e) {
    console.error("fetch profile error", e);
    res.status(500).json({ message: "failed to fetch profile" });
  }
}

// PUT /me - Update user profile (was inline in legacy routes/clients.js)
async function updateMe(req, res) {
  try {
    const userId = req.user.id;
    const { name, phone, avatar_url, first_name, last_name, dob } = req.body || {};

    const update = {};
    if (name) update.name = name;
    if (phone) update.phone = phone;
    if (avatar_url) update.avatar_url = avatar_url;
    if (first_name) update.first_name = first_name;
    if (last_name) update.last_name = last_name;
    if (dob) update.dob = new Date(dob);

    let client = await Client.findByIdAndUpdate(
      userId,
      { $set: update },
      { new: true }
    ).lean();

    if (!client) {
      client = await Client.findByIdAndUpdate(
        userId,
        {},
        { upsert: true, new: true }
      ).lean();
    }

    return res.json({
      name: client.name,
      phone: client.phone,
      avatar_url: client.avatar_url,
      client_id: client._id,
    });
  } catch (e) {
    console.error("update profile error", e);
    res.status(500).json({ message: "failed to update profile" });
  }
}

module.exports = { upsertClient, completeProfile, getMe, updateMe };

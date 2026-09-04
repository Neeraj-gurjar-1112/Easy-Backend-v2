const express = require("express");
const TokensController = require("./TokensController");

const router = express.Router();

// Register or refresh a device token
// POST /api/tokens/register { user_id, token, platform }
router.post("/register", TokensController.register);

module.exports = router;

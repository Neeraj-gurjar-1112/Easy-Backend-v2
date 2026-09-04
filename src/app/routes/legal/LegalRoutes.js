const express = require("express");
const LegalController = require("./LegalController");

const router = express.Router();

// PRIVACY POLICY PAGE (HTML)
router.get("/privacy-policy", LegalController.privacyPolicy);

// ACCOUNT DELETION PAGE (HTML)
router.get("/delete-account", LegalController.deleteAccountPage);

// ACCOUNT DELETION API ENDPOINT
router.delete("/account/:uid", LegalController.deleteAccount);

module.exports = router;

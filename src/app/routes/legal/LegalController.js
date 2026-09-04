/**
 * Legal pages + account deletion (mount: /legal). Handlers copied verbatim from
 * the legacy routes/legal.js. The two HTML pages are served inline; the DELETE
 * endpoint cascades a client's personal data. `global.firebaseAdmin` is kept
 * as-is (set up by lib/push/firebaseAdmin.js at boot).
 */
const { UserAddress, Client, Order, Feedback } = require("@models");

class LegalController {
  // GET /privacy-policy - PRIVACY POLICY PAGE (HTML)
  privacyPolicy(req, res) {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Privacy Policy - EasyApp</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            color: #333;
        }
        h1 { color: #2c3e50; margin-bottom: 10px; }
        h2 { color: #34495e; margin-top: 30px; }
        .last-updated { color: #7f8c8d; font-size: 0.9em; margin-bottom: 30px; }
        p { margin: 15px 0; }
        ul { margin: 10px 0; padding-left: 30px; }
        li { margin: 8px 0; }
        .contact { background: #f8f9fa; padding: 15px; border-radius: 5px; margin-top: 30px; }
    </style>
</head>
<body>
    <h1>Privacy Policy</h1>
    <p class="last-updated">Last Updated: January 8, 2026</p>

    <h2>1. Introduction</h2>
    <p>Welcome to EasyApp ("we," "our," or "us"). We respect your privacy and are committed to protecting your personal data. This privacy policy explains how we collect, use, and safeguard your information when you use our grocery delivery application.</p>

    <h2>2. Information We Collect</h2>
    <h3>Personal Information</h3>
    <ul>
        <li><strong>Account Information:</strong> Name, email address, phone number</li>
        <li><strong>Delivery Information:</strong> Delivery addresses, location coordinates</li>
        <li><strong>Payment Information:</strong> Payment method details (processed securely through third-party providers)</li>
        <li><strong>Order History:</strong> Products ordered, order amounts, delivery preferences</li>
    </ul>

    <h3>Automatically Collected Information</h3>
    <ul>
        <li><strong>Device Information:</strong> Device type, operating system, unique device identifiers</li>
        <li><strong>Usage Data:</strong> App interactions, features used, crash reports</li>
        <li><strong>Location Data:</strong> GPS coordinates for delivery and nearby store discovery</li>
    </ul>

    <h2>3. How We Use Your Information</h2>
    <ul>
        <li>Process and deliver your orders</li>
        <li>Communicate order status and updates</li>
        <li>Provide customer support</li>
        <li>Improve our services and user experience</li>
        <li>Send promotional offers (with your consent)</li>
        <li>Ensure platform security and prevent fraud</li>
        <li>Comply with legal obligations</li>
    </ul>

    <h2>4. Information Sharing</h2>
    <p>We do not sell your personal information. We share data only with:</p>
    <ul>
        <li><strong>Sellers/Restaurants:</strong> To fulfill your orders</li>
        <li><strong>Delivery Agents:</strong> For order delivery</li>
        <li><strong>Payment Processors:</strong> To process transactions securely</li>
        <li><strong>Service Providers:</strong> Cloud hosting, analytics, customer support</li>
        <li><strong>Legal Authorities:</strong> When required by law</li>
    </ul>

    <h2>5. Data Security</h2>
    <p>We implement industry-standard security measures including:</p>
    <ul>
        <li>Encrypted data transmission (HTTPS/TLS)</li>
        <li>Secure authentication (Firebase Auth)</li>
        <li>Access controls and monitoring</li>
        <li>Regular security audits</li>
    </ul>

    <h2>6. Your Rights</h2>
    <ul>
        <li><strong>Access:</strong> Request a copy of your personal data</li>
        <li><strong>Correction:</strong> Update inaccurate information</li>
        <li><strong>Deletion:</strong> Request account and data deletion</li>
        <li><strong>Opt-out:</strong> Unsubscribe from marketing communications</li>
        <li><strong>Data Portability:</strong> Receive your data in a structured format</li>
    </ul>

    <h2>7. Data Retention</h2>
    <p>We retain your personal data for as long as your account is active or as needed to provide services. After account deletion, we may retain certain data for legal, business, or security purposes for up to 90 days.</p>

    <h2>8. Children's Privacy</h2>
    <p>Our service is not intended for users under 13 years of age. We do not knowingly collect information from children.</p>

    <h2>9. Third-Party Services</h2>
    <ul>
        <li><strong>Firebase:</strong> Authentication and push notifications</li>
        <li><strong>Google Maps:</strong> Location and delivery services</li>
        <li><strong>Payment Gateways:</strong> Secure payment processing</li>
    </ul>
    <p>These services have their own privacy policies which we encourage you to review.</p>

    <h2>10. Changes to This Policy</h2>
    <p>We may update this privacy policy periodically. We will notify you of significant changes via email or app notification.</p>

    <h2>11. Account Deletion</h2>
    <p>You can request account deletion at any time by:</p>
    <ul>
        <li>Using the "Delete Account" option in app settings</li>
        <li>Visiting: <a href="${
          process.env.BASE_URL || "http://localhost:3000"
        }/legal/delete-account">${
    process.env.BASE_URL || "http://localhost:3000"
  }/legal/delete-account</a></li>
        <li>Contacting support at: support@easyapp.com</li>
    </ul>

    <div class="contact">
        <h2>12. Contact Us</h2>
        <p>If you have questions about this privacy policy or your data:</p>
        <ul>
            <li><strong>Email:</strong> privacy@easyapp.com</li>
            <li><strong>Support:</strong> support@easyapp.com</li>
            <li><strong>Address:</strong> [Your Business Address]</li>
        </ul>
    </div>
</body>
</html>
  `);
  }

  // GET /delete-account - ACCOUNT DELETION PAGE (HTML)
  deleteAccountPage(req, res) {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Delete Account - EasyApp</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            color: #333;
        }
        h1 { color: #e74c3c; }
        .warning {
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 20px 0;
        }
        .info-box {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
        }
        .delete-options {
            background: white;
            padding: 20px;
            border: 1px solid #dee2e6;
            border-radius: 5px;
            margin: 20px 0;
        }
        .option {
            margin: 15px 0;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 5px;
        }
        .option h3 {
            margin-top: 0;
            color: #2c3e50;
        }
        .contact {
            background: #e3f2fd;
            padding: 15px;
            border-radius: 5px;
            margin-top: 30px;
        }
        code {
            background: #f4f4f4;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: monospace;
        }
    </style>
</head>
<body>
    <h1>🗑️ Delete Your Account</h1>
    
    <div class="warning">
        <strong>⚠️ Warning:</strong> Account deletion is permanent and cannot be undone.
    </div>

    <div class="info-box">
        <h2>What Will Be Deleted:</h2>
        <ul>
            <li>✓ Your profile and personal information</li>
            <li>✓ Saved delivery addresses</li>
            <li>✓ Wishlist items</li>
            <li>✓ Reviews and ratings</li>
            <li>✓ Device tokens and preferences</li>
            <li>✓ Firebase authentication account</li>
        </ul>
        
        <h3>What Will Be Retained:</h3>
        <ul>
            <li>• Order history (anonymized for business records)</li>
            <li>• Transaction records (for legal compliance)</li>
        </ul>
    </div>

    <div class="delete-options">
        <h2>How to Delete Your Account:</h2>
        
        <div class="option">
            <h3>Option 1: In-App Deletion (Recommended)</h3>
            <ol>
                <li>Open the EasyApp mobile application</li>
                <li>Go to <strong>Settings</strong></li>
                <li>Scroll down and tap <strong>"Delete Account"</strong></li>
                <li>Confirm deletion</li>
            </ol>
            <p>Your account will be deleted immediately.</p>
        </div>

        <div class="option">
            <h3>Option 2: Email Request</h3>
            <p>Send an email to <strong>support@easyapp.com</strong> with:</p>
            <ul>
                <li>Subject: "Account Deletion Request"</li>
                <li>Your registered email address or phone number</li>
                <li>Reason for deletion (optional)</li>
            </ul>
            <p>We will process your request within <strong>48 hours</strong>.</p>
        </div>

        <div class="option">
            <h3>Option 3: API Endpoint (For Developers)</h3>
            <p>Send a DELETE request to:</p>
            <code>DELETE ${
              process.env.BASE_URL || "http://localhost:3000"
            }/api/users/:uid/account</code>
            <p>Requires Firebase authentication token in headers.</p>
        </div>
    </div>

    <div class="info-box">
        <h2>Data Retention Policy:</h2>
        <p>After deletion, your personal data is immediately removed. However:</p>
        <ul>
            <li>Anonymized order history may be retained for up to <strong>7 years</strong> (tax/legal compliance)</li>
            <li>Backup data is purged within <strong>90 days</strong></li>
            <li>Aggregated analytics data (non-identifiable) may be retained indefinitely</li>
        </ul>
    </div>

    <div class="contact">
        <h2>Need Help?</h2>
        <p>If you have questions or concerns about account deletion:</p>
        <ul>
            <li><strong>Email:</strong> support@easyapp.com</li>
            <li><strong>Privacy:</strong> privacy@easyapp.com</li>
        </ul>
    </div>

    <p style="text-align: center; color: #7f8c8d; margin-top: 40px;">
        <a href="/legal/privacy-policy">Privacy Policy</a> | 
        <a href="mailto:support@easyapp.com">Contact Support</a>
    </p>
</body>
</html>
  `);
  }

  // DELETE /account/:uid - ACCOUNT DELETION API ENDPOINT
  async deleteAccount(req, res) {
    try {
      const { uid } = req.params;

      // Find the client
      const client = await Client.findById(uid);
      if (!client) {
        return res.status(404).json({ error: "User not found" });
      }

      // Delete all user data
      const cascade = {};

      // 1. Delete addresses
      const addressesDel = await UserAddress.deleteMany({ user_id: uid });
      cascade.addressesDeleted = addressesDel?.deletedCount || 0;

      // 2. Delete device tokens
      const { DeviceToken } = require("@models");
      const tokensDel = await DeviceToken.deleteMany({
        user_id: `client_${client._id}`,
      });
      cascade.deviceTokensDeleted = tokensDel?.deletedCount || 0;

      // 3. Delete wishlist items
      const { Wishlist } = require("@models");
      const wishlistDel = await Wishlist.deleteMany({ client_id: client._id });
      cascade.wishlistDeleted = wishlistDel?.deletedCount || 0;

      // 4. Anonymize orders (keep for business records but remove personal data)
      await Order.updateMany(
        { client_id: uid },
        {
          $set: {
            client_phone: "[deleted]",
            "delivery_address.full_address": "[deleted]",
            "delivery_address.label": "[deleted]",
            "delivery_address.location": null,
          },
        }
      );
      cascade.ordersAnonymized = await Order.countDocuments({ client_id: uid });

      // 5. Delete reviews
      const { Review } = require("@models");
      const reviewsDel = await Review.deleteMany({ client_id: client._id });
      cascade.reviewsDeleted = reviewsDel?.deletedCount || 0;

      // 6. Delete feedback
      const feedbackDel = await Feedback.deleteMany({ user_id: uid });
      cascade.feedbackDeleted = feedbackDel?.deletedCount || 0;

      // 7. Delete from Firebase Auth
      try {
        await global.firebaseAdmin.auth().deleteUser(uid);
        cascade.firebaseUserDeleted = true;
      } catch (fe) {
        cascade.firebaseUserDeleted = false;
        cascade.firebaseDeleteError = fe?.message || String(fe);
      }

      // 8. Delete client document
      await Client.findByIdAndDelete(client._id);
      cascade.clientDeleted = true;

      console.log(`✅ User account deleted: ${uid}`, cascade);

      res.json({
        success: true,
        message: "Account deleted successfully",
        deleted_data: cascade,
      });
    } catch (error) {
      console.error("Error deleting account:", error);
      res.status(500).json({ error: "Failed to delete account" });
    }
  }
}

module.exports = new LegalController();

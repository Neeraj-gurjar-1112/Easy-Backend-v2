/**
 * Jest Test Setup
 * Suppresses expected error/warning logs during tests to keep output clean
 */

// Store original console methods
const originalError = console.error;
const originalWarn = console.warn;

// Patterns of expected errors that should be suppressed
const EXPECTED_ERROR_PATTERNS = [
  /Firebase token verification failed/,
  /Firebase Admin SDK not initialized/,
  /Optional token verification failed/,
  /Cannot read properties of undefined/,
  /Token expired/,
  /Token revoked/,
  /Invalid argument/,
  /Invalid token/,
  /Token too long/,
  /Something went wrong/,
  /Detailed internal error/,
  /JWT verification failed/,
  /jwt malformed/,
  /jwt expired/,
  // Admin route intentional test errors
  /delete product error/,
  /update order error/,
  /admin campaigns list error/,
  /create campaign error/,
  /update campaign error/,
  /admin feedback list error/,
  /create feedback error/,
  /update feedback error/,
  /admin clients list error/,
  /admin sellers list error/,
  /Error approving seller/,
  /admin products list error/,
  /admin product categories error/,
  /create product error/,
  /update product error/,
  /patch product error/,
  /admin device-tokens error/,
  /admin fix-address error/,
  /Get available agents error/,
  /manual assign error/,
  /admin roles list error/,
  /admin update role error/,
  /admin payouts summary error/,
  /admin payouts logs error/,
  /admin mark payout paid error/,
  /admin alerts evaluate error/,
  /admin alerts list error/,
  /admin alert ack error/,
  /Error listing orders/,
  /create client error/,
  /delete delivery agent error/,
  /create seller error/,
  /update seller error/,
  /Database error/,
  /Database connection error/,
  /Database connection lost/,
  /Database connection timeout/,
  /Database error during delete/,
  /DB error/,
  /Invalid or missing agentId/,
  /Can't use \$regex/,
  // Delivery test intentional errors
  /Error fetching agent location/,
  /Error fetching seller location/,
  /Error fetching pending orders/,
  // Seller test intentional errors
  /Error creating product/,
  /Update stock error/,
  /Error updating product/,
  /Error patching product/,
  /Error deleting product/,
  /Error listing products/,
  /Error fetching seller order by id/,
  // Auth test intentional errors
  /Delivery agent signup error/,
  /Seller login error/,
  /Forgot password error/,
  /Get user error/,
  /role-by-email error/,
  /Map-by-email error/,
  /whoami error/,
  /admin-detail error/,
  // Orders test intentional errors
  /Failed to publish cancel event/,
  /Cancel order error/,
  // Users test intentional errors
  /Error creating address/,
  /Error fetching addresses/,
  /Error updating address/,
  /Error deleting address/,
  /Error fetching profile/,
  /Error updating profile/,
  /Error updating preferences/,
  /Error fetching orders/,
  /Error creating feedback/,
  // Mongoose validation errors (intentional)
  /ValidationError/,
  /CastError/,
  /validation failed/,
  /Cast to ObjectId failed/,
  /Address validation failed/,
  // Database operation errors (intentional)
  /Database find error/,
  /Database findById error/,
  /Database aggregate error/,
  /Database save failed/,
  /Database write error/,
  /Database write failed/,
  /Database delete error/,
  /Database query error/,
  /Database update error/,
  /Preferences update failed/,
  /Orders query failed/,
  /Feedback creation failed/,
  /SSE publish failed/,
  /Database connection failed/,
  /Database connection error/,
  /Database connection lost/,
  /DB connection lost/,
  /Aggregation error/,
  /Update failed/,
  // Restaurant test errors
  /restaurant get error/,
  /restaurant update error/,
  // Product test errors
  /Error in POST \/products\/prices/,
  /Error in POST \/products\/stock/,
  // Token test errors
  /token register error/,
  // Seller feedback errors
  /seller feedback create error/,
  /seller feedback list error/,
  /seller earnings summary error/,
  /seller earnings logs error/,
  /Error listing seller orders/,
  // Client/profile errors
  /upsertClient error/,
  /completeProfile error/,
  /fetch profile error/,
  /update profile error/,
  // Image optimization errors
  /Image optimization error/,
  /Image optimization failed/,
  /Input buffer contains unsupported image format/,
  /Input Buffer is empty/,
  /Failed to optimize image/,
  /Sharp error/,
  /Generation failed/,
  /Error generating multiple sizes/,
  /Auto-optimize middleware error/,
  /Read failed/,
  /Image validation error/,
  /Invalid image/,
  // Seller order errors
  /toggle-open error/,
  /Error accepting order/,
  /Error checking timeouts/,
  /Error retrying pending orders/,
  /Retry DB error/,
  // Agent earnings errors
  /agent earnings breakdown error/,
  /Cast to date failed/,
  /Breakdown error/,
  /Error fetching agent profile/,
  /Profile error/,
  // Cart errors
  /Cart GET error/,
  /Cart PUT error/,
  /Lean method failed/,
  // Upload errors
  /upload route error/,
  // Admin reporting errors
  /admin reporting overview error/,
  /admin fraud signals error/,
  /admin settings update error/,
  // Type errors from mocked functions
  /is not a function/,
];

// Patterns of expected warnings that should be suppressed
const EXPECTED_WARN_PATTERNS = [
  /Optional token verification failed/,
  /client roles enrichment failed/,
  /Manual assign publish error/,
  /publish is not defined/,
  /superagent: double callback bug/,
  /Failed to revoke refresh tokens/,
  /There is no user record corresponding to the provided identifier/,
  /seller per-item tokens fetch failed/,
  /Cast to ObjectId failed for value/,
  /\[clientsController\] Dropped legacy email_1 index/,
  /\[upsertClient\] phone conflict/,
  /Ignored legacy email unique index conflict/,
];

// Patterns of expected console.log messages that should be suppressed
const EXPECTED_LOG_PATTERNS = [
  /injected env (d+) from .env/,
  /\[ADMIN\] Coupon (created|updated|deleted):/,
  /\[METRICS\] (Fetched|Computed):/,
  /at log \(routes\/(admin|delivery|orders|seller|uploads|clientsController)\.js:\d+:\d+\)/,
  /at log \(controllers\/clientsController\.js:\d+:\d+\)/,
];

// Override console.log to filter expected log messages
const originalLog = console.log;
console.log = (...args) => {
  const message = args[0]?.toString() || "";

  // Check if this is an expected log message
  const isExpectedLog = EXPECTED_LOG_PATTERNS.some((pattern) =>
    pattern.test(message)
  );

  if (!isExpectedLog) {
    originalLog(...args);
  }
};

// Override console.error to filter expected errors
console.error = (...args) => {
  const message = args[0]?.toString() || "";

  // Check if this is an expected error
  const isExpectedError = EXPECTED_ERROR_PATTERNS.some((pattern) =>
    pattern.test(message)
  );

  // Only log if it's NOT an expected error
  if (!isExpectedError) {
    originalError.apply(console, args);
  }
};

// Override console.warn to filter expected warnings
console.warn = (...args) => {
  const message = args[0]?.toString() || "";

  // Check if this is an expected warning
  const isExpectedWarn = EXPECTED_WARN_PATTERNS.some((pattern) =>
    pattern.test(message)
  );

  // Only log if it's NOT an expected warning
  if (!isExpectedWarn) {
    originalWarn.apply(console, args);
  }
};

// Restore original console methods after all tests
afterAll(() => {
  console.error = originalError;
  console.warn = originalWarn;
});

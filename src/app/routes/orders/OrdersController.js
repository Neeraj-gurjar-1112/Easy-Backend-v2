/**
 * Orders controller (mount: /api/orders).
 * createOrder / getStatus / getHistory come verbatim from the legacy
 * controllers/ordersController.js; adminDetail / stream / cancel were inline
 * handlers in the legacy routes/orders.js. verifyPayment / updateDelivery are
 * shared with the admin service and delegate to @lib/orders/handlers.
 */
const {
  Order,
  UserAddress,
  Seller,
  Product,
  PlatformSettings,
  EarningLog,
  DeliveryAgent,
} = require("@models");
const { buildGroupedOrders } = require("@util/pricing");
const {
  addClient,
  publish,
  publishToSeller,
  publishToAdmin,
} = require("@events/orderEvents");
const { notifyOrderUpdate } = require("@push");
const { genRef, buildEnrichedSnapshot } = require("@lib/orders/snapshot");
const handlers = require("@lib/orders/handlers");

class OrdersController {
  // POST /  (COD-only)
  async createOrder(req, res) {
    try {
      // Check for authentication - require either client_id in body or authenticated user
      const authHeader = req.headers.authorization;
      const hasAuth = authHeader && authHeader.startsWith("Bearer ");
      const hasClientId = req.body && req.body.client_id;

      if (!hasAuth && !hasClientId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      // Extract client_id from JWT if present
      let authenticatedUserId = null;
      if (hasAuth) {
        try {
          const token = authHeader.substring(7); // Remove "Bearer " prefix
          const jwt = require("jsonwebtoken");
          const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET || "test_secret_key",
          );
          authenticatedUserId = decoded.userId || decoded.id || decoded.sub;
        } catch (e) {
          // Token invalid, will rely on client_id from body if present
          // This is expected for tests using mock tokens
          // console.log("JWT decode failed:", e.message);
        }
      }

      let {
        items,
        client_id,
        seller_id,
        note,
        method,
        delivery_address_id,
        delivery_address,
        coupon, // optional coupon code
        coupon_code, // alternative field name
      } = req.body || {};

      // Use coupon_code if coupon not provided
      if (!coupon && coupon_code) {
        coupon = coupon_code;
      }

      // Validate items array
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "No items provided" });
      }

      // Fetch all products to validate availability and stock - MUST happen before buildGroupedOrders
      const productIds = items.map((i) => i.product_id).filter(Boolean);
      const products = await Product.find({
        _id: { $in: productIds },
      }).lean();

      const productMap = new Map(products.map((p) => [String(p._id), p]));

      // Validate each item
      for (const item of items) {
        const product = productMap.get(String(item.product_id));

        if (!product) {
          return res
            .status(400)
            .json({ error: `Product not found: ${item.product_id}` });
        }

        // Check if product status is active (matches Product schema: status="active"|"inactive")
        // Also support legacy 'available' boolean field if present
        const isAvailable =
          product.available !== undefined
            ? product.available === true
            : product.status === "active";

        if (!isAvailable) {
          return res
            .status(400)
            .json({ error: `Product ${product.name} is not available` });
        }

        // Check stock (Product schema uses 'stock', not 'stock_quantity')
        const requestedQty = Number(item.quantity || item.qty || 1);
        const availableStock = product.stock_quantity ?? product.stock;
        if (availableStock != null && availableStock < requestedQty) {
          return res.status(400).json({
            error: `Insufficient stock for ${product.name}. Available: ${availableStock}, Requested: ${requestedQty}`,
          });
        }
      }

      // Use authenticated user ID from JWT if available, otherwise use provided client_id or generate guest ID
      if (authenticatedUserId) {
        client_id = authenticatedUserId;
      } else if (
        !client_id ||
        typeof client_id !== "string" ||
        client_id.trim() === ""
      ) {
        client_id = `guest_${genRef("G")}`;
      }

      // Build grouped orders by category: grocery (grocery+vegetables) vs food (restaurant)
      const grouped = await buildGroupedOrders(items);

      // Handle delivery address
      let addressData = null;

      if (delivery_address_id) {
        // Use existing address from user's saved addresses
        let addressObjId = delivery_address_id;

        // Check if it's a valid ObjectId format (24 hex characters)
        const mongoose = require("mongoose");
        if (
          typeof addressObjId === "string" &&
          addressObjId.length === 24 &&
          /^[0-9a-fA-F]{24}$/.test(addressObjId)
        ) {
          try {
            addressObjId = mongoose.Types.ObjectId(addressObjId);
          } catch (e) {
            console.log("Failed to convert to ObjectId:", e);
            addressObjId = null;
          }
        } else {
          // If not a valid ObjectId format, try to find by string comparison
          console.log(
            "Not a valid ObjectId format, trying string lookup for:",
            delivery_address_id,
          );
          addressObjId = null;
        }

        let savedAddress = null;
        if (addressObjId) {
          console.log(
            "Looking up address by ObjectId:",
            addressObjId,
            "for user:",
            client_id,
          );
          savedAddress = await UserAddress.findOne({
            _id: addressObjId,
            user_id: client_id,
          });
          console.log("Address found by ObjectId:", savedAddress ? "YES" : "NO");
        }

        // If not found by ObjectId, try to find by other identifiers
        if (!savedAddress && delivery_address_id) {
          console.log("Trying alternative address lookup methods...");

          // Try to find by delivery_address_id as a string (might be stored as string in some cases)
          savedAddress = await UserAddress.findOne({
            user_id: client_id,
            $or: [
              { _id: delivery_address_id },
              { full_address: delivery_address_id }, // In case the ID is actually the address text
            ],
          }).catch((e) => {
            console.log("Alternative lookup failed:", e.message);
            return null;
          });

          console.log(
            "Address found by alternative method:",
            savedAddress ? "YES" : "NO",
          );

          // If still not found and delivery_address is provided, use it as fallback
          if (
            !savedAddress &&
            delivery_address &&
            delivery_address.full_address
          ) {
            console.log(
              "Looking up by full_address from delivery_address:",
              delivery_address.full_address,
            );
            savedAddress = await UserAddress.findOne({
              user_id: client_id,
              full_address: delivery_address.full_address,
            });
            console.log(
              "Address found by full_address match:",
              savedAddress ? "YES" : "NO",
            );
          }
        }

        if (savedAddress) {
          console.log("Using saved address:", savedAddress.full_address);
          addressData = {
            address_id: savedAddress._id,
            full_address: savedAddress.full_address,
            street: savedAddress.street,
            recipient_name: savedAddress.recipient_name,
            recipient_phone: savedAddress.recipient_phone,
            landmark: savedAddress.landmark,
            location: savedAddress.location,
          };
        } else {
          console.log(
            "No saved address found, checking if delivery_address is provided as fallback...",
          );
        }
      }

      // If no address found from ID lookup, try to use provided delivery_address
      if (!addressData && delivery_address) {
        // Use provided address (for guest checkout or new address)
        let fullAddress =
          delivery_address.full_address || delivery_address.address;

        // If full_address not provided but structured fields are, construct it
        if (!fullAddress && typeof delivery_address === "object") {
          const parts = [];
          if (delivery_address.street) parts.push(delivery_address.street);
          if (delivery_address.city) parts.push(delivery_address.city);
          if (delivery_address.state) parts.push(delivery_address.state);
          if (delivery_address.zip) parts.push(delivery_address.zip);
          fullAddress = parts.join(", ");
        }

        // Fallback to string conversion
        if (!fullAddress && typeof delivery_address === "string") {
          fullAddress = delivery_address;
        }

        if (fullAddress && fullAddress.trim()) {
          addressData = {
            full_address: fullAddress.trim(),
            street: typeof delivery_address === "object" ? delivery_address.street : undefined,
            recipient_name: delivery_address.recipient_name,
            recipient_phone: delivery_address.recipient_phone,
            landmark: delivery_address.landmark,
            location: delivery_address.location,
          };
        }
      }

      // Validate that we have a valid delivery address
      if (
        !addressData ||
        !addressData.full_address ||
        addressData.full_address.trim() === ""
      ) {
        console.error("Address validation failed:", {
          hasAddressData: !!addressData,
          hasFullAddress: addressData?.full_address,
          fullAddressValue: addressData?.full_address,
          delivery_address_id,
          delivery_address,
        });
        return res.status(400).json({
          error:
            "Delivery address is required. Please provide a valid delivery address.",
          details:
            "Either delivery_address_id or delivery_address with full_address must be provided",
          debug: {
            received_address_id: delivery_address_id,
            received_address: delivery_address,
            processed_address: addressData,
          },
        });
      }

      // Force COD irrespective of requested method
      let paymentMethod = "COD";

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes

      // Determine per-group delivery charges from PlatformSettings or defaults
      let deliveryCharges = { grocery: 30, food: 40 };
      let minDeliveryThreshold = 100;
      let adminCompensation = { enabled: false, payment: 0 };
      try {
        const { PlatformSettings } = require("@models");
        const ps = await PlatformSettings.findOne().lean();
        if (ps) {
          deliveryCharges = {
            grocery: Number(ps.delivery_charge_grocery ?? 30),
            food: Number(ps.delivery_charge_food ?? 40),
          };
          if (typeof ps.min_total_for_delivery_charge === "number") {
            minDeliveryThreshold = Number(ps.min_total_for_delivery_charge);
          }
          // Admin compensation for "free" deliveries
          adminCompensation = {
            enabled: ps.free_delivery_admin_compensation === true,
            payment: Number(ps.free_delivery_agent_payment ?? 0),
          };
        }
      } catch (_) {}

      // Pre-compute coupon discount (if any) across all groups so we can persist immutable amounts.
      let couponDiscountTotal = 0;
      let couponCode =
        coupon && typeof coupon === "string" && coupon.trim()
          ? coupon.trim()
          : null;
      if (couponCode) {
        try {
          // Use PlatformSettings coupon logic similar to /products/quote
          const { PlatformSettings } = require("@models");
          const settings = await PlatformSettings.findOne(
            {},
            { coupons: 1 },
          ).lean();
          const coupons = settings?.coupons || [];
          const now = new Date();
          const subtotalAll = grouped.reduce(
            (s, g) => s + Number(g.total || 0),
            0,
          );
          // Category presence detection: gather product categories from provided items list via Product lookup
          const pidsAll = (items || [])
            .map((i) => (i && i.product_id ? i.product_id : null))
            .filter(Boolean);
          const prods = pidsAll.length
            ? await Product.find(
                { _id: { $in: pidsAll } },
                { category: 1 },
              ).lean()
            : [];
          const present = { grocery: false, vegetable: false, food: false };
          for (const p of prods) {
            const c = (p.category || "").toString().toLowerCase();
            if (c.includes("grocery")) present.grocery = true;
            if (c.includes("vegetable")) present.vegetable = true;
            if (c.includes("restaurant") || c.includes("food"))
              present.food = true;
          }
          const found = coupons.find((c) => {
            if (!c || !c.code) return false;
            const codeOk =
              String(c.code).toUpperCase().trim() === couponCode.toUpperCase();
            const activeOk = c.active !== false;
            const timeOk =
              (!c.validFrom || new Date(c.validFrom) <= now) &&
              (!c.validTo || new Date(c.validTo) >= now);
            const minOk = subtotalAll >= (Number(c.minSubtotal) || 0);
            let catOk = true;
            if (
              c.categories &&
              Array.isArray(c.categories) &&
              c.categories.length > 0
            ) {
              catOk = c.categories.some(
                (x) =>
                  (x === "grocery" && present.grocery) ||
                  (x === "vegetable" && present.vegetable) ||
                  (x === "food" && present.food),
              );
            }

            // Check seller restrictions
            let sellerOk = true;
            if (
              c.seller_ids &&
              Array.isArray(c.seller_ids) &&
              c.seller_ids.length > 0
            ) {
              // Coupon restricted to specific sellers - check if any order items are from allowed sellers
              const allowedSellerIds = new Set(
                c.seller_ids.map((id) => String(id)),
              );
              const orderSellerIds = grouped
                .map((g) => String(g.key))
                .filter(Boolean);
              sellerOk = orderSellerIds.some((sid) => allowedSellerIds.has(sid));
            }

            if (
              c.excluded_seller_ids &&
              Array.isArray(c.excluded_seller_ids) &&
              c.excluded_seller_ids.length > 0
            ) {
              // Check if order contains items from excluded sellers
              const excludedSellerIds = new Set(
                c.excluded_seller_ids.map((id) => String(id)),
              );
              const orderSellerIds = grouped
                .map((g) => String(g.key))
                .filter(Boolean);
              sellerOk =
                sellerOk &&
                !orderSellerIds.some((sid) => excludedSellerIds.has(sid));
            }

            return codeOk && activeOk && timeOk && minOk && catOk && sellerOk;
          });

          if (!found) {
            return res.status(400).json({ error: "Invalid coupon code" });
          }

          // Check usage limit
          const usageLimit = found.usage_limit;
          const usageCount = found.usage_count || 0;
          if (usageLimit != null && usageCount >= usageLimit) {
            return res.status(400).json({ error: "Coupon usage limit reached" });
          }

          // Check per-user usage limit
          const maxPerUser = found.max_uses_per_user;
          if (maxPerUser != null && client_id) {
            const usedBy = Array.isArray(found.used_by) ? found.used_by : [];
            // Handle both simple string arrays and object arrays with client_id property
            const userUsageCount = usedBy.filter((u) => {
              const id = typeof u === "object" && u.client_id ? u.client_id : u;
              return String(id) === String(client_id);
            }).length;
            if (userUsageCount >= maxPerUser) {
              return res
                .status(400)
                .json({ error: "You have already used this coupon" });
            }
          }

          // Calculate discount
          const percent = Number(found.percent || 0);
          if (percent > 0) {
            couponDiscountTotal =
              Math.round(((subtotalAll * percent) / 100) * 100) / 100;
          }
        } catch (e) {
          console.error("Coupon validation error:", e);
          return res.status(400).json({ error: "Invalid coupon code" });
        }
      }

      const createdOrders = [];
      const subtotalAllGroups =
        grouped.reduce((s, g) => s + Number(g.total || 0), 0) || 0;
      let discountRemainder = couponDiscountTotal;
      for (const g of grouped) {
        const orderData = {
          client_id,
          seller_id: seller_id || undefined, // optional; keep compatibility
          order_items: g.orderItems,
          payment: {
            amount: g.total,
            method: paymentMethod,
            status: "pending",
          },
          expires_at: expiresAt,
          published: true,
        };

        if (addressData) {
          // Apply threshold per group: waive charge when group total >= threshold
          const baseCharge = Number(deliveryCharges[g.key] || 0);
          const applyCharge = Number(g.total || 0) < Number(minDeliveryThreshold);
          const deliveryWaived = !applyCharge; // true when customer gets free delivery

          // Fetch seller information to get pickup address
          let pickupAddressData = null;
          try {
            // Get seller from first product in the order items
            const firstPid = g.orderItems[0]?.product_id;
            if (firstPid) {
              const prod = await Product.findById(firstPid)
                .select("seller_id")
                .lean();
              if (prod?.seller_id) {
                const seller = await Seller.findById(prod.seller_id)
                  .select("business_name address location place_id")
                  .lean();
                if (seller) {
                  pickupAddressData = {
                    full_address: seller.address || "Address not provided",
                    business_name: seller.business_name,
                    location:
                      seller.location &&
                      seller.location.lat != null &&
                      seller.location.lng != null
                        ? {
                            lat: Number(seller.location.lat),
                            lng: Number(seller.location.lng),
                          }
                        : null,
                    place_id: seller.place_id || null,
                  };
                }
              }
            }
          } catch (err) {
            console.error("Error fetching seller for pickup address:", err);
          }

          orderData.delivery = {
            delivery_status: "pending",
            delivery_address: addressData,
            pickup_address: pickupAddressData, // Add seller pickup address
            delivery_charge: applyCharge ? baseCharge : 0,
            // Admin compensation: when delivery is waived but admin pays agent
            admin_pays_agent: deliveryWaived && adminCompensation.enabled,
            admin_agent_payment:
              deliveryWaived && adminCompensation.enabled
                ? adminCompensation.payment
                : 0,
          };
        }

        if (couponCode) {
          orderData.coupon_code = couponCode;
          // Allocate proportional discount to this order
          if (couponDiscountTotal > 0 && subtotalAllGroups > 0) {
            let share = 0;
            if (couponDiscountTotal && subtotalAllGroups) {
              share =
                (Number(g.total || 0) / subtotalAllGroups) * couponDiscountTotal;
            }
            // Round to 2 decimals and ensure sum matches total (last group takes remainder)
            let allocated = Math.round(share * 100) / 100;
            if (g === grouped[grouped.length - 1])
              allocated = Math.round(discountRemainder * 100) / 100;
            orderData.applied_discount_amount = allocated; // positive number representing absolute discount
            discountRemainder =
              Math.round((discountRemainder - allocated) * 100) / 100;
          }
        }
        const order = await Order.create(orderData);
        createdOrders.push(order);
      }

      // Publish SSE/push for each created order
      const responses = [];
      for (const order of createdOrders) {
        const snapshot = await buildEnrichedSnapshot(order);
        publish(String(order._id), snapshot);
        // Publish to all sellers who own items in this order
        try {
          const pids = (order.order_items || [])
            .map((oi) => oi.product_id)
            .filter(Boolean);
          if (pids.length > 0) {
            const prods = await Product.find(
              { _id: { $in: pids } },
              { seller_id: 1 },
            ).lean();
            const sellerIds = [...new Set(prods.map((p) => String(p.seller_id)))];
            for (const sid of sellerIds) publishToSeller(sid, snapshot);
          }
        } catch (_) {}
        try {
          await notifyOrderUpdate(
            order.toObject ? order.toObject() : order,
            snapshot,
          );
        } catch (_) {}
        responses.push({
          order_id: order._id,
          amount: order.payment?.amount || 0,
          currency: "INR",
          method: paymentMethod,
          status: order.payment?.status,
          expires_at: expiresAt,
          delivery_charge: order.delivery?.delivery_charge || 0,
          // Include order items and details for tests
          items: order.order_items || [],
          subtotal:
            (order.payment?.amount || 0) - (order.delivery?.delivery_charge || 0),
          discount: order.applied_discount_amount || 0,
        });
      }

      // Return format expected by tests: single order with grouped_orders array
      if (responses.length === 1) {
        return res.status(201).json({
          ...responses[0],
          grouped_orders: [responses[0]], // Wrap in array for test compatibility
        });
      }
      return res
        .status(201)
        .json({ orders: responses, grouped_orders: responses });
    } catch (err) {
      console.error("createOrder error:", err);
      res.status(400).json({ message: err.message || "Failed to create order" });
    }
  }

  // GET /:id/status
  async getStatus(req, res) {
    try {
      const { id } = req.params;
      const order = await Order.findById(id).lean();
      if (!order) return res.status(404).json({ message: "Order not found" });
      const updatedAt = order.payment?.verified?.at || new Date();

      // Derive ETA minutes remaining if eta_at is set (eta_at stored under delivery.eta_at)
      let etaMinutes = null;
      if (order.delivery && order.delivery.eta_at) {
        const etaMs = new Date(order.delivery.eta_at).getTime() - Date.now();
        if (etaMs > 0) {
          etaMinutes = Math.ceil(etaMs / 60000);
        } else {
          etaMinutes = 0;
        }
      }
      // Reuse same enrichment as SSE
      const enriched = await buildEnrichedSnapshot(order, etaMinutes, updatedAt);
      res.json(enriched);
    } catch (err) {
      res.status(500).json({ message: "Failed to get status" });
    }
  }

  // GET /:id/admin-detail - enriched snapshot + earnings/commission breakdown
  async adminDetail(req, res) {
    try {
      const { id } = req.params;
      const order = await Order.findById(id).lean();
      if (!order) return res.status(404).json({ message: "Order not found" });
      const snap = await buildEnrichedSnapshot(order);
      // Commission & earnings (on-demand computation if EarningLog not yet written)
      const settings = await PlatformSettings.findOne(
        {},
        { platform_commission_rate: 1, delivery_agent_share_rate: 1 },
      )
        .lean()
        .catch(() => null);
      const commissionRate = Number(settings?.platform_commission_rate ?? 0.1);
      const agentShareRate = Number(settings?.delivery_agent_share_rate ?? 0.8);
      // Item totals per seller
      const pids = (order.order_items || [])
        .map((oi) => oi.product_id)
        .filter(Boolean);
      let prodMap = new Map();
      if (pids.length) {
        const prods = await Product.find(
          { _id: { $in: pids } },
          { _id: 1, seller_id: 1 },
        ).lean();
        for (const p of prods) prodMap.set(String(p._id), String(p.seller_id));
      }
      const sellerTotals = new Map();
      for (const oi of order.order_items || []) {
        const sid = prodMap.get(String(oi.product_id));
        if (!sid) continue;
        const line = Number(oi.price_snapshot || 0) * Number(oi.qty || 0);
        sellerTotals.set(sid, (sellerTotals.get(sid) || 0) + line);
      }
      const sellers = [];
      for (const [sid, itemTotal] of sellerTotals.entries()) {
        const commission = +(itemTotal * commissionRate).toFixed(2);
        const net = +(itemTotal - commission).toFixed(2);
        sellers.push({
          seller_id: sid,
          item_total: +itemTotal.toFixed(2),
          platform_commission: commission,
          net_earning: net,
        });
      }
      // Prefer delivery charge from enriched snapshot (includes fallback for legacy orders)
      const deliveryCharge = Number(
        snap?.delivery_charge ?? order.delivery?.delivery_charge ?? 0,
      );
      let agentNet = null;
      if (order.delivery?.delivery_agent_id && deliveryCharge > 0) {
        agentNet = +(deliveryCharge * agentShareRate).toFixed(2);
      }
      // If EarningLog entries exist (post-delivery) prefer stored values
      try {
        const logs = await EarningLog.find({ order_id: id }).lean();
        if (Array.isArray(logs) && logs.length) {
          const sellersFromLogs = logs
            .filter((l) => l.role === "seller")
            .map((l) => ({
              seller_id: String(l.seller_id),
              item_total: l.item_total,
              platform_commission: l.platform_commission,
              net_earning: l.net_earning,
            }));
          if (sellersFromLogs.length) snap.earnings_sellers = sellersFromLogs;
          const agentLog = logs.find((l) => l.role === "delivery");
          if (agentLog)
            snap.earnings_agent = {
              agent_id: String(agentLog.agent_id),
              delivery_charge: agentLog.delivery_charge,
              net_earning: agentLog.net_earning,
            };
        } else {
          if (sellers.length) snap.earnings_sellers = sellers;
          if (agentNet != null)
            snap.earnings_agent = {
              delivery_charge: deliveryCharge,
              net_earning: agentNet,
            };
        }
      } catch (_) {
        if (sellers.length) snap.earnings_sellers = sellers;
        if (agentNet != null)
          snap.earnings_agent = {
            delivery_charge: deliveryCharge,
            net_earning: agentNet,
          };
      }
      snap.platform_commission_rate = commissionRate;
      snap.delivery_agent_share_rate = agentShareRate;
      return res.json(snap);
    } catch (e) {
      console.error("admin-detail error", e?.message || e);
      res.status(500).json({ message: "Failed to fetch admin detail" });
    }
  }

  // POST /:id/verify - shared with admin service (lib/orders/handlers)
  verifyPayment(req, res, next) {
    return handlers.verifyPayment(req, res, next);
  }

  // GET /history/:clientId
  async getHistory(req, res) {
    try {
      const { clientId } = req.params;
      if (!clientId)
        return res.status(400).json({ message: "clientId required" });
      // Fetch most recent 20 orders for this client
      const orders = await Order.find({ client_id: clientId })
        .sort({ _id: -1 })
        .limit(20)
        .lean();
      const response = orders.map((o) => {
        const d = o.delivery || {};
        const delStatus = d.delivery_status || "pending";

        return {
          // canonical fields
          _id: String(o._id),
          order_id: String(o._id),
          createdAt: o.created_at || o._id.getTimestamp(),
          // Main status field (most authoritative - includes cancelled, delivered, etc.)
          status: o.status || "pending",
          // payment
          total_amount: Number(o.payment?.amount || 0),
          currency: "INR",
          method: o.payment?.method || "COD",
          payment_status: o.payment?.status || "pending",
          // delivery charge surfaced for client history UIs
          delivery_charge: Number(d.delivery_charge || o.delivery_charge || 0),
          // delivery
          delivery_status: delStatus,

          // items simplified for UI
          items: (o.order_items || []).map((oi) => ({
            product_id: oi.product_id,
            quantity: oi.qty,
            price: oi.price_snapshot,
            name: oi.name_snapshot,
          })),
        };
      });
      res.json({ orders: response });
    } catch (err) {
      console.error("getHistory error:", err);
      res.status(500).json({ message: "Failed to fetch history" });
    }
  }

  // PATCH /:id/delivery - shared with admin service (lib/orders/handlers)
  updateDelivery(req, res, next) {
    return handlers.updateDelivery(req, res, next);
  }

  // GET /:id/stream - SSE stream for live order updates
  async stream(req, res) {
    const { id } = req.params;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write(": connected\n\n");

    // Send an initial snapshot immediately so clients don't wait for the next update
    try {
      const order = await Order.findById(id);
      if (order) {
        const snap = await buildEnrichedSnapshot(order);
        const data = `event: update\ndata: ${JSON.stringify(snap)}\n\n`;
        res.write(data);
      }
    } catch (_) {
      // ignore; stream will still deliver future updates
    }
    addClient(id, res);
  }

  // POST /:orderId/cancel (COD only, no refunds)
  async cancel(req, res) {
    try {
      const { orderId } = req.params;
      const { cancelled_by, cancellation_reason } = req.body;

      if (!cancelled_by) {
        return res.status(400).json({
          error: "cancelled_by is required (user_id or seller_id or agent_id)",
        });
      }

      const order = await Order.findById(orderId);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Check if order can be cancelled (not already delivered/cancelled)
      if (order.status === "delivered") {
        return res.status(400).json({ error: "Cannot cancel delivered orders" });
      }

      if (order.status === "cancelled") {
        return res.status(400).json({ error: "Order is already cancelled" });
      }

      // Update order to cancelled
      order.status = "cancelled";
      order.cancelled_by = cancelled_by;
      order.cancellation_reason = cancellation_reason || "No reason provided";
      order.cancelled_at = new Date();

      const savedOrder = await order.save();

      // If order had a delivery agent assigned, free them up
      if (order.delivery?.delivery_agent_id) {
        const agent = await DeliveryAgent.findById(
          order.delivery.delivery_agent_id,
        );
        if (agent) {
          agent.available = true;
          agent.assigned_orders = Math.max(0, (agent.assigned_orders || 1) - 1);
          await agent.save();
        }
      }

      // Publish SSE updates to all connected clients (customer, seller, admin, delivery agent)
      try {
        const snapshot = await buildEnrichedSnapshot(order);

        // Publish to customer
        publish(String(order._id), snapshot);

        // Publish to seller/restaurant
        if (snapshot.seller_id) {
          publishToSeller(String(snapshot.seller_id), snapshot);
        }

        // Publish to admin dashboard
        publishToAdmin(snapshot);

        // Send push notifications
        await notifyOrderUpdate(
          order.toObject ? order.toObject() : order,
          snapshot,
        );

        console.log(
          `Order ${order._id} cancelled - SSE and push notifications sent to customer, seller, and admin`,
        );
      } catch (sseError) {
        console.error("Failed to publish cancel event:", sseError);
        // Don't fail the request if SSE/push fails
      }

      res.json({
        message: "Order cancelled successfully",
        order: {
          _id: order._id,
          status: order.status,
          cancelled_by: order.cancelled_by,
          cancellation_reason: order.cancellation_reason,
          cancelled_at: order.cancelled_at,
        },
      });
    } catch (error) {
      console.error("Cancel order error:", error);
      res.status(500).json({ error: "Failed to cancel order" });
    }
  }
}

module.exports = new OrdersController();

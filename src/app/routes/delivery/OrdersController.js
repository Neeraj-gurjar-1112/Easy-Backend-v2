/**
 * OrdersController - delivery agent API (mounted at /api/delivery).
 * Handler bodies copied verbatim from legacy routes/delivery.js; only require paths changed.
 */
const mongoose = require("mongoose");
const {
  Order,
  DeliveryAgent,
  EarningLog,
  Product,
  PlatformSettings,
  Seller,
  Client,
} = require("@models");
const { publish, publishToSeller } = require("@events/orderEvents");
const { notifyOrderUpdate } = require("@push");
const {
  calculateDistance,
  calcDistanceKM,
  _calculateAgentEarning,
  _effectiveDeliveryCharge,
} = require("./helpers");

class OrdersController {
  /**
   * Get pending orders for delivery agent
   * Legacy: GET /api/delivery/pending-orders/:agentId
   */
  async pendingOrders(req, res, next) {
    try {
      const { agentId } = req.params;
      // Cast agentId for comparisons against ObjectId fields
      let agentObjId = null;
      try {
        agentObjId = new mongoose.Types.ObjectId(agentId);
      } catch (_) {}

      // Check if agent has any active orders
      const activeOrderCount = await Order.countDocuments({
        "delivery.delivery_agent_id": agentId,
        "delivery.delivery_status": {
          $in: ["accepted", "picked_up", "in_transit"],
        },
      });

      // Get orders that are accepted by seller but not yet assigned to delivery agent
      const baseFilter = {
        status: { $nin: ["pending", "cancelled", "delivered", "refunded"] },
        "delivery.delivery_status": "pending",
      };
      // Pending orders include: unassigned OR previously rejected (by someone else)
      const orFilter = [
        { "delivery.delivery_agent_id": null },
        { "delivery.delivery_agent_id": { $exists: false } },
        {
          "delivery.delivery_agent_id": { $ne: null },
          "delivery.delivery_agent_response": "rejected",
        },
      ];
      // Exclude any order that this agent has already been offered/rejected before
      const notTriedByAgent = agentObjId
        ? {
            "delivery.assignment_history": {
              $not: { $elemMatch: { agent_id: agentObjId } },
            },
          }
        : {};

      const pendingOrders = await Order.find({
        ...baseFilter,
        $or: orFilter,
        ...(notTriedByAgent || {}),
      })
        .populate("client_id", "name phone")
        .populate(
          "seller_id",
          "business_name phone address location business_type place_id",
        )
        .populate("order_items.product_id", "category seller_id")
        .sort({ created_at: -1 })
        .limit(10);

      // Format orders for delivery agent UI (with optional server-side geocode)
      const formattedOrders = await Promise.all(
        pendingOrders.map(async (order) => {
          const kindsSet = new Set();
          for (const it of order.order_items || []) {
            const cat = it?.product_id?.category || it?.category;
            const k = (cat || "").toString().toLowerCase();
            if (!k) continue;
            if (k.includes("vegetable")) kindsSet.add("vegetables");
            else if (k.includes("grocery")) kindsSet.add("grocery");
            else if (k.includes("restaurant") || k.includes("food"))
              kindsSet.add("food");
          }
          if (!kindsSet.size) {
            const bt = order.seller_id?.business_type?.toString().toLowerCase();
            if (bt) {
              if (bt.includes("grocery")) kindsSet.add("grocery");
              else if (bt.includes("restaurant") || bt.includes("food"))
                kindsSet.add("food");
            }
          }
          const kinds = Array.from(kindsSet);
          // Compose readable pickup/destination strings with fallbacks (and server geocode when enabled)
          // Resolve seller object: prefer direct order.seller_id; fallback to first product's seller_id
          let sellerObj = order.seller_id;
          if (
            !sellerObj &&
            Array.isArray(order.order_items) &&
            order.order_items.length > 0
          ) {
            const pSeller = order.order_items[0]?.product_id?.seller_id;
            if (pSeller) {
              try {
                sellerObj = await Seller.findById(pSeller)
                  .select(
                    "business_name phone address location business_type place_id",
                  )
                  .lean();
              } catch (_) {}
            }
          }
          const sellerAddr = sellerObj?.address;
          const sellerLoc = sellerObj?.location;
          let pickupAddr = sellerAddr && sellerAddr.trim() ? sellerAddr : null;
          if (!pickupAddr) {
            try {
              const {
                reverseGeocode,
                placeDetails,
                ENABLED,
              } = require("@util/geocode");
              if (ENABLED) {
                if (order.seller_id?.place_id) {
                  const pd = await placeDetails(order.seller_id.place_id);
                  if (pd) pickupAddr = pd;
                }
                if (
                  !pickupAddr &&
                  sellerLoc &&
                  sellerLoc.lat != null &&
                  sellerLoc.lng != null
                ) {
                  const rg = await reverseGeocode(
                    Number(sellerLoc.lat),
                    Number(sellerLoc.lng),
                  );
                  if (rg) pickupAddr = rg;
                }
              }
            } catch (_) {}
            if (!pickupAddr) {
              pickupAddr =
                sellerLoc && sellerLoc.lat != null && sellerLoc.lng != null
                  ? `${Number(sellerLoc.lat).toFixed(5)}, ${Number(
                      sellerLoc.lng,
                    ).toFixed(5)}`
                  : "Store address";
            }
          }
          const da = order.delivery?.delivery_address;
          const street = da?.street?.trim();
          const fullAddr = da?.full_address?.trim();
          const clientAddr = [street, fullAddr].filter(Boolean).join(", ");
          const clientLoc = da?.location;
          const destAddr =
            clientAddr && clientAddr.trim()
              ? clientAddr
              : clientLoc && clientLoc.lat != null && clientLoc.lng != null
                ? `${Number(clientLoc.lat).toFixed(5)}, ${Number(
                    clientLoc.lng,
                  ).toFixed(5)}`
                : "Address not available";
          const deliveryCharge = await _effectiveDeliveryCharge(order);
          const agentEarning = await _calculateAgentEarning(
            deliveryCharge,
            order,
          );

          // Calculate total collectible amount: (Subtotal + Delivery - Discount)
          // Only collect if method is COD and status is not paid
          const _subtotal = Number(order.payment?.amount || 0);
          const _discount = Number(order.applied_discount_amount || 0);
          const _totalVal = Math.max(0, _subtotal + deliveryCharge - _discount);
          const _isPaid = ["paid", "claimed"].includes(order.payment?.status);
          const _isCOD = (order.payment?.method || "COD") === "COD";
          const collectionAmount = _isCOD && !_isPaid ? _totalVal : 0;

          return {
            order_id: order._id,
            store:
              sellerObj?.business_name ||
              order.seller_id?.business_name ||
              "Store",
            delivery_to: destAddr,
            recipient_name:
              order.delivery?.delivery_address?.recipient_name ||
              order.client_id?.name,
            recipient_phone:
              order.delivery?.delivery_address?.recipient_phone ||
              order.client_id?.phone,
            collection_amount: collectionAmount, // Total to collect from customer
            delivery_charge: deliveryCharge,
            agent_earning: agentEarning, // Agent's share of delivery charge
            items: order.order_items?.length || 0,
            items_details: (order.order_items || []).map(it => ({
              name: it.name_snapshot || (it.product_id && it.product_id.name ? it.product_id.name : "Item"),
              qty: it.qty || 1,
              price: it.price_snapshot || 0
            })),
            created_at: order.created_at,
            pickup_address: pickupAddr,
            // Provide coordinates to avoid client-side geocoding where possible - only if valid
            store_location:
              sellerObj?.location?.lat != null && sellerObj?.location?.lng != null
                ? { lat: sellerObj.location.lat, lng: sellerObj.location.lng }
                : order.seller_id?.location?.lat != null &&
                    order.seller_id?.location?.lng != null
                  ? {
                      lat: order.seller_id.location.lat,
                      lng: order.seller_id.location.lng,
                    }
                  : null,
            client_location:
              order.delivery?.delivery_address?.location?.lat != null &&
              order.delivery?.delivery_address?.location?.lng != null
                ? {
                    lat: order.delivery.delivery_address.location.lat,
                    lng: order.delivery.delivery_address.location.lng,
                  }
                : null,
            kinds,
          };
        }),
      );

      res.json({
        orders: formattedOrders,
        hasActiveOrder: activeOrderCount > 0,
        activeOrderCount: activeOrderCount,
      });
    } catch (error) {
      console.error("Error fetching pending orders:", error);
      res.status(500).json({ error: "Failed to fetch pending orders" });
    }
  }

  /**
   * Lightweight "offers" feed for an agent: orders currently assigned to them and awaiting response
   * Legacy: GET /api/delivery/offers/:agentId
   */
  async offers(req, res, next) {
    try {
      const { agentId } = req.params;

      // Check if agent exists and is active
      const agent = await DeliveryAgent.findById(agentId)
        .select("active available approved")
        .lean();

      // If agent is not active, return empty offers (they shouldn't see any offers when inactive)
      if (!agent || !agent.active) {
        return res.json({
          orders: [],
          hasActiveOrder: false,
          activeOrderCount: 0,
          message: agent
            ? "You are currently inactive. Turn on to receive offers."
            : "Agent not found",
        });
      }

      let agentObjId = null;
      try {
        agentObjId = new mongoose.Types.ObjectId(agentId);
      } catch (_) {}

      // Check if agent has any active orders
      const activeOrderCount = await Order.countDocuments({
        "delivery.delivery_agent_id": agentId,
        "delivery.delivery_status": {
          $in: ["accepted", "picked_up", "in_transit"],
        },
      });

      const offers = await Order.find({
        status: { $nin: ["pending", "cancelled", "delivered", "refunded"] },
        "delivery.delivery_agent_id": agentId,
        "delivery.delivery_agent_response": "pending",
        "delivery.delivery_status": { $in: ["assigned", "pending"] },
        ...(agentObjId
          ? {
              "delivery.assignment_history": {
                $not: {
                  $elemMatch: {
                    agent_id: agentObjId,
                    response: { $in: ["rejected"] },
                  },
                },
              },
            }
          : {}),
      })
        .populate(
          "seller_id",
          "business_name address location business_type place_id",
        )
        .populate("order_items.product_id", "category seller_id")
        .sort({ created_at: -1 })
        .lean();
      const offersOut = await Promise.all(
        offers.map(async (o) => {
          const kindsSet = new Set();
          for (const it of o.order_items || []) {
            const cat = it?.product_id?.category || it?.category;
            const k = (cat || "").toString().toLowerCase();
            if (!k) continue;
            if (k.includes("vegetable")) kindsSet.add("vegetables");
            else if (k.includes("grocery")) kindsSet.add("grocery");
            else if (k.includes("restaurant") || k.includes("food"))
              kindsSet.add("food");
          }
          if (!kindsSet.size) {
            const bt = o.seller_id?.business_type?.toString().toLowerCase();
            if (bt) {
              if (bt.includes("grocery")) kindsSet.add("grocery");
              else if (bt.includes("restaurant") || bt.includes("food"))
                kindsSet.add("food");
            }
          }
          const kinds = Array.from(kindsSet);
          // Resolve seller object: direct or via first product's seller
          let sellerObj = o.seller_id;
          if (
            !sellerObj &&
            Array.isArray(o.order_items) &&
            o.order_items.length > 0
          ) {
            const pSeller = o.order_items[0]?.product_id?.seller_id;
            if (pSeller) {
              try {
                sellerObj = await Seller.findById(pSeller)
                  .select("business_name address location business_type place_id")
                  .lean();
              } catch (_) {}
            }
          }
          const sellerAddr = sellerObj?.address;
          const sellerLoc = sellerObj?.location;
          let pickupAddr = sellerAddr && sellerAddr.trim() ? sellerAddr : null;
          if (!pickupAddr) {
            try {
              const {
                reverseGeocode,
                placeDetails,
                ENABLED,
              } = require("@util/geocode");
              if (ENABLED) {
                if (o.seller_id?.place_id) {
                  const pd = await placeDetails(o.seller_id.place_id);
                  if (pd) pickupAddr = pd;
                }
                if (
                  !pickupAddr &&
                  sellerLoc &&
                  sellerLoc.lat != null &&
                  sellerLoc.lng != null
                ) {
                  const rg = await reverseGeocode(
                    Number(sellerLoc.lat),
                    Number(sellerLoc.lng),
                  );
                  if (rg) pickupAddr = rg;
                }
              }
            } catch (_) {}
            if (!pickupAddr) {
              pickupAddr =
                sellerLoc && sellerLoc.lat != null && sellerLoc.lng != null
                  ? `${Number(sellerLoc.lat).toFixed(5)}, ${Number(
                      sellerLoc.lng,
                    ).toFixed(5)}`
                  : "Store address";
            }
          }
          const da = o.delivery?.delivery_address;
          const street = da?.street?.trim();
          const fullAddr = da?.full_address?.trim();
          const clientAddr = [street, fullAddr].filter(Boolean).join(", ");
          const clientLoc = da?.location;
          const destAddr =
            clientAddr && clientAddr.trim()
              ? clientAddr
              : clientLoc && clientLoc.lat != null && clientLoc.lng != null
                ? `${Number(clientLoc.lat).toFixed(5)}, ${Number(
                    clientLoc.lng,
                  ).toFixed(5)}`
                : "Address not available";
          const deliveryCharge = await _effectiveDeliveryCharge(o);
          const agentEarning = await _calculateAgentEarning(deliveryCharge, o);

          const _subtotal = Number(o.payment?.amount || 0);
          const _discount = Number(o.applied_discount_amount || 0);
          const _totalVal = Math.max(0, _subtotal + deliveryCharge - _discount);
          const _isPaid = ["paid", "claimed"].includes(o.payment?.status);
          const _isCOD = (o.payment?.method || "COD") === "COD";
          const collectionAmount = _isCOD && !_isPaid ? _totalVal : 0;

          const storeLocation =
            sellerObj?.location || o.seller_id?.location || null;
          const clientLocation = o.delivery?.delivery_address?.location || null;

          return {
            order_id: o._id,
            store:
              sellerObj?.business_name || o.seller_id?.business_name || "Store",
            pickup_address: pickupAddr,
            // Provide destination address so the app can preview trip distance/time
            delivery_to: destAddr,
            collection_amount: collectionAmount, // Total to collect from customer
            delivery_charge: deliveryCharge,
            agent_earning: agentEarning, // Agent's share of delivery charge
            status: o.delivery?.delivery_status || "assigned",
            recipient_name: o.delivery?.delivery_address?.recipient_name || o.client_id?.name || undefined,
            recipient_phone: o.delivery?.delivery_address?.recipient_phone || o.client_id?.phone || undefined,
            items: o.order_items?.length || 0,
            items_details: (o.order_items || []).map(it => ({
              name: it.name_snapshot || (it.product_id && it.product_id.name ? it.product_id.name : "Item"),
              qty: it.qty || 1,
              price: it.price_snapshot || 0
            })),
            // Provide coordinates to avoid client-side geocoding where possible - only if valid
            store_location:
              sellerObj?.location?.lat != null && sellerObj?.location?.lng != null
                ? { lat: sellerObj.location.lat, lng: sellerObj.location.lng }
                : o.seller_id?.location?.lat != null &&
                    o.seller_id?.location?.lng != null
                  ? {
                      lat: o.seller_id.location.lat,
                      lng: o.seller_id.location.lng,
                    }
                  : null,
            client_location:
              o.delivery?.delivery_address?.location?.lat != null &&
              o.delivery?.delivery_address?.location?.lng != null
                ? {
                    lat: o.delivery.delivery_address.location.lat,
                    lng: o.delivery.delivery_address.location.lng,
                  }
                : null,
            kinds,
          };
        }),
      );
      res.json({
        orders: offersOut,
        hasActiveOrder: activeOrderCount > 0,
        activeOrderCount: activeOrderCount,
      });
    } catch (e) {
      console.error("Error fetching offers:", e);
      res.status(500).json({ error: "Failed to fetch offers" });
    }
  }

  /**
   * Get assigned orders for delivery agent
   * Legacy: GET /api/delivery/assigned-orders/:agentId
   */
  async assignedOrders(req, res, next) {
    try {
      const { agentId } = req.params;

      const assignedOrders = await Order.find({
        "delivery.delivery_agent_id": agentId,
        "delivery.delivery_agent_response": "accepted",
        "delivery.delivery_status": {
          $in: ["accepted", "picked_up", "in_transit"],
        },
      })
        .populate("client_id", "name phone")
        .populate(
          "seller_id",
          "business_name phone address location business_type",
        )
        // include seller_id on product so we can fallback when order.seller_id is missing
        .populate("order_items.product_id", "category seller_id")
        .sort({ created_at: -1 });

      const formattedOrders = await Promise.all(
        assignedOrders.map(async (order) => {
          const kindsSet = new Set();
          for (const it of order.order_items || []) {
            const cat = it?.product_id?.category || it?.category;
            const k = (cat || "").toString().toLowerCase();
            if (!k) continue;
            if (k.includes("vegetable")) kindsSet.add("vegetables");
            else if (k.includes("grocery")) kindsSet.add("grocery");
            else if (k.includes("restaurant") || k.includes("food"))
              kindsSet.add("food");
          }
          if (!kindsSet.size) {
            const bt = order.seller_id?.business_type?.toString().toLowerCase();
            if (bt) {
              if (bt.includes("grocery")) kindsSet.add("grocery");
              else if (bt.includes("restaurant") || bt.includes("food"))
                kindsSet.add("food");
            }
          }
          const kinds = Array.from(kindsSet);
          // Resolve seller object: prefer direct order.seller_id; fallback to first product's seller_id
          let sellerObj = order.seller_id;
          if (
            !sellerObj &&
            Array.isArray(order.order_items) &&
            order.order_items.length > 0
          ) {
            const pSeller = order.order_items[0]?.product_id?.seller_id;
            if (pSeller) {
              try {
                sellerObj = await Seller.findById(pSeller)
                  .select(
                    "business_name phone address location business_type place_id",
                  )
                  .lean();
              } catch (_) {}
            }
          }
          // Compose pickup address with same fallback chain as offers/pending
          const sellerAddr = sellerObj?.address || order.seller_id?.address;
          const sellerLoc = sellerObj?.location || order.seller_id?.location;
          let pickupAddr = sellerAddr && sellerAddr.trim() ? sellerAddr : null;
          if (!pickupAddr) {
            try {
              const {
                reverseGeocode,
                placeDetails,
                ENABLED,
              } = require("@util/geocode");
              if (ENABLED) {
                const placeId = sellerObj?.place_id || order.seller_id?.place_id;
                if (placeId) {
                  const pd = await placeDetails(placeId);
                  if (pd) pickupAddr = pd;
                }
                if (
                  !pickupAddr &&
                  sellerLoc &&
                  sellerLoc.lat != null &&
                  sellerLoc.lng != null
                ) {
                  const rg = await reverseGeocode(
                    Number(sellerLoc.lat),
                    Number(sellerLoc.lng),
                  );
                  if (rg) pickupAddr = rg;
                }
              }
            } catch (_) {}
            if (!pickupAddr) {
              pickupAddr =
                sellerLoc && sellerLoc.lat != null && sellerLoc.lng != null
                  ? `${Number(sellerLoc.lat).toFixed(5)}, ${Number(
                      sellerLoc.lng,
                    ).toFixed(5)}`
                  : "Store address";
            }
          }

          // Normalize recipient/client contact details with robust fallbacks
          const da = order.delivery?.delivery_address || {};

          // Resolve client document
          let clientDoc = null;
          try {
            const cid = order.client_id;
            if (cid) {
              if (
                typeof cid === "string" &&
                cid.length === 24 &&
                /^[0-9a-fA-F]{24}$/.test(cid)
              ) {
                clientDoc = await Client.findById(cid).select("name phone").lean();
              }
            }
          } catch (_) {}
          const recName =
            da.recipient_name ||
            da.name ||
            da.full_name ||
            da.display_name ||
            order.client_id?.name ||
            clientDoc?.name ||
            undefined;
          const recPhone =
            da.recipient_phone ||
            da.phone ||
            da.mobile ||
            da.contact ||
            da.contact_number ||
            da.mobile_number ||
            order.client_id?.phone ||
            clientDoc?.phone ||
            undefined;

          // Prefer populated seller object if available
          const sellerPhone = sellerObj?.phone || order.seller_id?.phone || null;
          // Compute effective delivery charge if not persisted
          const deliveryCharge = await _effectiveDeliveryCharge(order);

          // Fetch agent's current location from DeliveryAgent document
          let agentLocation = null;
          if (order.delivery?.delivery_agent_id) {
            try {
              const agent = await DeliveryAgent.findById(
                order.delivery.delivery_agent_id,
              )
                .select("current_location updated_at")
                .lean();
              if (
                agent?.current_location?.lat != null &&
                agent?.current_location?.lng != null
              ) {
                agentLocation = {
                  lat: agent.current_location.lat,
                  lng: agent.current_location.lng,
                  updated_at:
                    agent.current_location.updated_at || agent.updatedAt || null,
                };
              }
            } catch (err) {
              console.error("Error fetching agent location:", err);
            }
          }
          // Fallback to accept_location if current location unavailable
          if (
            !agentLocation &&
            order.delivery?.accept_location?.lat != null &&
            order.delivery?.accept_location?.lng != null
          ) {
            agentLocation = {
              lat: order.delivery.accept_location.lat,
              lng: order.delivery.accept_location.lng,
              updated_at: null,
            };
          }

          const _subtotal = Number(order.payment?.amount || 0);
          const _discount = Number(order.applied_discount_amount || 0);
          const _totalVal = Math.max(0, _subtotal + deliveryCharge - _discount);
          const _isPaid = ["paid", "claimed"].includes(order.payment?.status);
          const _isCOD = (order.payment?.method || "COD") === "COD";
          const collectionAmount = _isCOD && !_isPaid ? _totalVal : 0;

          return {
            order_id: order._id,
            store:
              sellerObj?.business_name ||
              order.seller_id?.business_name ||
              "Store",
            delivery_to: (() => {
              const da = order.delivery?.delivery_address;
              if (!da) return "Address not available";
              const street = da.street?.trim();
              const fullAddr = da.full_address?.trim();
              return [street, fullAddr].filter(Boolean).join(", ") || "Address not available";
            })(),
            recipient_name: recName,
            recipient_phone: recPhone,
            // Canonical aliases to maximize client compatibility
            customer_phone: recPhone,
            contact_number: recPhone,
            mobile_number: recPhone,
            // Direct contact fields for quick access
            client_name:
              order.client_id?.name || clientDoc?.name || recName || null,
            client_phone:
              order.client_id?.phone || clientDoc?.phone || recPhone || null,
            seller_name:
              sellerObj?.business_name || order.seller_id?.business_name || null,
            seller_phone: sellerPhone,
            // Alias used by some clients
            store_phone: sellerPhone,
            // Nested objects for UI components expecting these keys
            client:
              (order.client_id &&
                (order.client_id.name || order.client_id.phone)) ||
              clientDoc
                ? {
                    name:
                      order.client_id &&
                      (order.client_id.name || order.client_id.phone)
                        ? order.client_id.name
                        : clientDoc?.name,
                    phone:
                      order.client_id &&
                      (order.client_id.name || order.client_id.phone)
                        ? order.client_id.phone
                        : clientDoc?.phone,
                  }
                : recName || recPhone
                  ? { name: recName, phone: recPhone }
                  : undefined,
            customer:
              recName || recPhone
                ? { name: recName, phone: recPhone }
                : undefined,
            recipient:
              recName || recPhone
                ? { name: recName, phone: recPhone }
                : undefined,
            seller: sellerObj
              ? {
                  name: sellerObj.business_name,
                  phone: sellerObj.phone,
                  address: sellerObj.address,
                }
              : undefined,
            total_amount: order.payment?.amount || 0,
            delivery_charge: deliveryCharge,
            status: order.delivery?.delivery_status || "accepted",
            // Provide explicit delivery_status as well for clients that prefer it
            delivery_status: order.delivery?.delivery_status || "accepted",
            pickup_time: order.delivery?.pickup_time,
            estimated_delivery: order.delivery?.estimated_delivery_time,
            pickup_address: pickupAddr,
            store_location:
              sellerObj?.location?.lat != null && sellerObj?.location?.lng != null
                ? { lat: sellerObj.location.lat, lng: sellerObj.location.lng }
                : order.seller_id?.location?.lat != null &&
                    order.seller_id?.location?.lng != null
                  ? {
                      lat: order.seller_id.location.lat,
                      lng: order.seller_id.location.lng,
                    }
                  : null,
            client_location:
              order.delivery?.delivery_address?.location?.lat != null &&
              order.delivery?.delivery_address?.location?.lng != null
                ? {
                    lat: order.delivery.delivery_address.location.lat,
                    lng: order.delivery.delivery_address.location.lng,
                  }
                : null,
            agent_location: agentLocation,
            kinds,
            collection_amount: collectionAmount,
            agent_earning: await _calculateAgentEarning(deliveryCharge, order),
            items: order.order_items?.length || 0,
            items_details: (order.order_items || []).map(it => ({
              name: it.name_snapshot || (it.product_id && it.product_id.name ? it.product_id.name : "Item"),
              qty: it.qty || 1,
              price: it.price_snapshot || 0
            })),
          };
        }),
      );

      res.json(formattedOrders);
    } catch (error) {
      console.error("Error fetching assigned orders:", error);
      res.status(500).json({ error: "Failed to fetch assigned orders" });
    }
  }

  /** Legacy: GET /api/delivery/history/:agentId */
  async history(req, res, next) {
    try {
      const { agentId } = req.params;

      const deliveredOrders = await Order.find({
        "delivery.delivery_agent_id": agentId,
        "delivery.delivery_status": "delivered",
      })
        .populate("client_id", "name")
        .populate("seller_id", "business_name location")
        .sort({ "delivery.delivery_end_time": -1 })
        .limit(50);

      const formattedOrders = await Promise.all(
        deliveredOrders.map(async (order) => {
          // Always compute delivery charge if missing or zero
          let deliveryCharge = Number(order.delivery?.delivery_charge || 0);
          // Always use computed charge if missing or zero
          const computedCharge = await _effectiveDeliveryCharge(order);
          if (!deliveryCharge || deliveryCharge <= 0) {
            deliveryCharge = computedCharge;
          }
          // If still zero, use computed value
          if (!deliveryCharge || deliveryCharge <= 0) {
            deliveryCharge = computedCharge;
          }

          // Route info: from agent accept location to store, then store to client
          // Try multiple sources for store location
          let storeLocation = null;
          // Priority 1: From delivery pickup_address (always check this first)
          const pickupLoc = order.delivery?.pickup_address?.location;
          if (pickupLoc) {
            if (process.env.DEBUG_DELIVERY_ROUTING === "1") {
              console.log(
                `🔎 pickup_address.location for order ${order._id}:`,
                pickupLoc,
              );
            }
            // Accept if lat/lng are present and numbers or numeric strings
            let lat = pickupLoc.lat;
            let lng = pickupLoc.lng;
            if (typeof lat === "string") lat = parseFloat(lat);
            if (typeof lng === "string") lng = parseFloat(lng);
            if (
              typeof lat === "number" &&
              !isNaN(lat) &&
              typeof lng === "number" &&
              !isNaN(lng)
            ) {
              storeLocation = { lat, lng };
            }
          }
          // Priority 2: From populated seller
          if (
            !storeLocation &&
            order.seller_id?.location?.lat &&
            order.seller_id?.location?.lng
          ) {
            storeLocation = order.seller_id.location;
          }
          // Priority 3: Fetch seller separately if we have seller_id
          if (!storeLocation && order.seller_id?._id) {
            try {
              const seller = await Seller.findById(order.seller_id._id)
                .select("location")
                .lean();
              if (seller?.location?.lat && seller?.location?.lng) {
                storeLocation = seller.location;
              }
            } catch (err) {
              console.error(
                `Error fetching seller location for order ${order._id}:`,
                err,
              );
            }
          }

          const routeInfo = {
            accept_location: order.delivery?.accept_location || null,
            store_location: storeLocation,
            client_location: order.delivery?.delivery_address?.location || null,
            pickup_time: order.delivery?.pickup_time || null,
            delivered_time: order.delivery?.delivery_end_time || null,
          };

          // Debug logging for route info
          if (!routeInfo.store_location) {
            if (process.env.DEBUG_DELIVERY_ROUTING === "1") {
              console.log(`⚠️ Missing store_location for order ${order._id}:`, {
                has_seller: !!order.seller_id,
                seller_id: order.seller_id?._id,
                seller_has_location: !!order.seller_id?.location,
                has_pickup_address: !!order.delivery?.pickup_address,
                pickup_has_location: !!order.delivery?.pickup_address?.location,
              });
            }
          }

          // Calculate KM if locations are available
          let km_agent_to_store = null,
            km_store_to_client = null;
          if (routeInfo.accept_location && routeInfo.store_location) {
            km_agent_to_store = calcDistanceKM(
              routeInfo.accept_location,
              routeInfo.store_location,
            );
          }
          if (routeInfo.store_location && routeInfo.client_location) {
            km_store_to_client = calcDistanceKM(
              routeInfo.store_location,
              routeInfo.client_location,
            );
          }

          const _subtotal = Number(order.payment?.amount || 0);
          const _discount = Number(order.applied_discount_amount || 0);
          const _totalVal = Math.max(0, _subtotal + deliveryCharge - _discount);
          const _isPaid = ["paid", "claimed"].includes(order.payment?.status);
          const _isCOD = (order.payment?.method || "COD") === "COD";
          const collectionAmount = _isCOD && !_isPaid ? _totalVal : 0;

          return {
            order_id: order._id,
            store: order.seller_id?.business_name || "Store",
            delivered_to: (() => {
              const da = order.delivery?.delivery_address;
              if (!da) return "Address";
              const street = da.street?.trim();
              const fullAddr = da.full_address?.trim();
              return [street, fullAddr].filter(Boolean).join(", ") || "Address";
            })(),
            delivery_date: order.delivery?.delivery_end_time,
            total_amount: order.payment?.amount || 0,
            delivery_charge: deliveryCharge,
            collection_amount: collectionAmount,
            agent_earning: await _calculateAgentEarning(deliveryCharge, order),
            route_info: routeInfo,
            km_agent_to_store,
            km_store_to_client,
          };
        }),
      );

      res.json(formattedOrders);
    } catch (error) {
      console.error("Error fetching delivery history:", error);
      res.status(500).json({ error: "Failed to fetch delivery history" });
    }
  }

  /**
   * Accept order delivery
   * Legacy: POST /api/delivery/accept-order
   */
  async acceptOrder(req, res, next) {
    try {
      const { orderId, agentId, agentLocation } = req.body;

      const order = await Order.findById(orderId).populate("seller_id");
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Idempotency: if already accepted by this agent, return success without side effects
      if (
        String(order.delivery?.delivery_agent_id || "") === String(agentId) &&
        String(order.delivery?.delivery_agent_response || "") === "accepted" &&
        ["accepted", "picked_up", "in_transit"].includes(
          String(order.delivery?.delivery_status || "").toLowerCase(),
        )
      ) {
        return res.json({ message: "Order already accepted", order });
      }

      // Race condition check: if already accepted by ANOTHER agent, return error
      if (
        order.delivery?.delivery_agent_id &&
        String(order.delivery.delivery_agent_id) !== String(agentId) &&
        ["accepted", "picked_up", "in_transit"].includes(
          String(order.delivery?.delivery_status || "").toLowerCase(),
        )
      ) {
        return res.status(400).json({ error: "Order already accepted by another agent." });
      }

  // Check if agent has any active orders (not yet delivered or cancelled)
      // const activeOrders = await Order.countDocuments({
      //   "delivery.delivery_agent_id": agentId,
      //   "delivery.delivery_status": {
      //     $in: ["accepted", "picked_up", "in_transit"],
      //   },
      // });

      // const ps = (await PlatformSettings.findOne().lean()) || {};
      // const maxOrders = Number(ps.max_delivery_orders_per_agent ?? 3);

      // if (activeOrders >= maxOrders) {
      //   return res.status(400).json({
      //     error: "Cannot accept new order",
      //     message: `You have reached the limit of ${maxOrders} active orders. Complete one to accept more.`,
      //     hasActiveOrder: true,
      //   });
      // }
      // Prepare update fields
      const updateFields = {
        "delivery.delivery_agent_id": agentId,
        "delivery.delivery_agent_response": "accepted",
        "delivery.delivery_status": "accepted",
      };

      // Capture agent's location at acceptance time
      if (agentLocation && agentLocation.lat && agentLocation.lng) {
        updateFields["delivery.accept_location"] = {
          lat: agentLocation.lat,
          lng: agentLocation.lng,
        };
      }

      // Always set pickup_address.location if possible
      let pickupLocation = null;
      let pickupFullAddress = order.seller_id?.business_name || "Store";
      if (order.seller_id?.location?.lat && order.seller_id?.location?.lng) {
        pickupLocation = {
          lat: order.seller_id.location.lat,
          lng: order.seller_id.location.lng,
        };
      } else if (
        order.delivery?.pickup_address?.location?.lat &&
        order.delivery?.pickup_address?.location?.lng
      ) {
        pickupLocation = {
          lat: order.delivery.pickup_address.location.lat,
          lng: order.delivery.pickup_address.location.lng,
        };
        pickupFullAddress =
          order.delivery.pickup_address.full_address || pickupFullAddress;
      }
      if (pickupLocation) {
        updateFields["delivery.pickup_address"] = {
          full_address: pickupFullAddress,
          location: pickupLocation,
        };
      } else {
        // Pickup location not available - may be set later
        // console.warn(
        //   `⚠️ Could not set pickup_address.location for order ${order._id}`
        // );
      }

      // Update order with delivery agent assignment
      let updatedOrder = await Order.findByIdAndUpdate(
        orderId,
        {
          $set: updateFields,
          $push: {
            "delivery.assignment_history": {
              agent_id: agentId,
              assigned_at: new Date(),
              response: "accepted",
              response_at: new Date(),
            },
          },
        },
        { new: true },
      );



      // Update agent's assigned orders count
      await DeliveryAgent.findByIdAndUpdate(agentId, {
        $inc: { assigned_orders: 1 },
      });

      // Publish SSE + push (suppress seller/admin to avoid repeated pings, but notify client)
      try {
        const {
          buildEnrichedSnapshot,
        } = require("@lib/orders/snapshot");
        const snapshot = await buildEnrichedSnapshot(updatedOrder);
        publish(String(updatedOrder._id), snapshot);
        // Do not publish to seller channel here to avoid duplicate buzz; rely on SSE for live UIs
        await notifyOrderUpdate(
          updatedOrder.toObject ? updatedOrder.toObject() : updatedOrder,
          snapshot,
          {
            excludeRoles: [
              "agent",
              "delivery",
              "delivery_agent",
              "seller",
              "admin",
            ],
          },
        );
      } catch (_) {}

      res.json({ message: "Order accepted successfully", order: updatedOrder });
    } catch (error) {
      console.error("Error accepting order:", error);
      res.status(500).json({ error: "Failed to accept order" });
    }
  }

  /**
   * Reject order delivery
   * Legacy: POST /api/delivery/reject-order
   */
  async rejectOrder(req, res, next) {
    try {
      const { orderId, agentId } = req.body;

      // Update assignment history
      await Order.findByIdAndUpdate(orderId, {
        $push: {
          "delivery.assignment_history": {
            agent_id: agentId,
            assigned_at: new Date(),
            response: "rejected",
            response_at: new Date(),
          },
        },
      });

      // Disabled auto-assignment of delivery agents here
      // Orders will remain unassigned (pending) and broadcasted to all delivery agents 
      // so they can pick them up from the pool.
      let updatedOrder = await Order.findByIdAndUpdate(
        orderId,
        {
          $set: {
            "delivery.delivery_agent_id": null,
            "delivery.delivery_agent_response": "rejected",
            "delivery.delivery_status": "pending",
          },
        },
        { new: true },
      );

      // Publish SSE + push (acceptance: notify all roles)
      try {
        const {
          buildEnrichedSnapshot,
        } = require("@lib/orders/snapshot");
        const snapshot = await buildEnrichedSnapshot(updatedOrder);
        publish(String(updatedOrder._id), snapshot);
        if (snapshot.seller_id)
          publishToSeller(String(snapshot.seller_id), snapshot); // sanitized in publisher
        await notifyOrderUpdate(
          updatedOrder.toObject ? updatedOrder.toObject() : updatedOrder,
          snapshot,
        );
      } catch (_) {}

      res.json({
        message: "Order rejected and reset to pending pool",
      });
    } catch (error) {
      console.error("Error rejecting order:", error);
      res.status(500).json({ error: "Failed to reject order" });
    }
  }

  /**
   * Admin force reassign order (for timeout or manual intervention)
   * Legacy: POST /api/delivery/force-reassign/:orderId
   */
  async forceReassign(req, res, next) {
    try {
      const { orderId } = req.params;

      const order = await Order.findById(orderId).lean();
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      const currentAgentId = order.delivery?.delivery_agent_id;
      const triedAgentIds = new Set(
        (order?.delivery?.assignment_history || []).map((h) =>
          String(h.agent_id),
        ),
      );
      if (currentAgentId) {
        triedAgentIds.add(String(currentAgentId));
      }

      // Get store location for distance calculation
      let storeLat, storeLng;
      const itemProductIds = (order.order_items || [])
        .map((i) => i && i.product_id)
        .filter(Boolean);
      if (itemProductIds.length) {
        const firstProduct = await Product.findById(itemProductIds[0]).populate(
          "seller_id",
        );
        if (
          firstProduct?.seller_id?.location?.lat &&
          firstProduct?.seller_id?.location?.lng
        ) {
          storeLat = firstProduct.seller_id.location.lat;
          storeLng = firstProduct.seller_id.location.lng;
        }
      }

      // Fallback to pickup_address or delivery address
      if (!storeLat || !storeLng) {
        storeLat =
          order.pickup_address?.location?.lat ||
          order.delivery?.delivery_address?.location?.lat;
        storeLng =
          order.pickup_address?.location?.lng ||
          order.delivery?.delivery_address?.location?.lng;
      }

      // Find all available agents who haven't been tried yet
      const availableAgents = await DeliveryAgent.find({
        approved: true,
        active: true,
        available: true,
        _id: { $nin: Array.from(triedAgentIds) },
      }).lean();

      let nextAgent = null;
      if (availableAgents.length > 0 && storeLat && storeLng) {
        // Calculate distance for each agent and select nearest
        const agentsWithDistance = availableAgents
          .filter(
            (agent) => agent.current_location?.lat && agent.current_location?.lng,
          )
          .map((agent) => ({
            agent,
            distance: calculateDistance(
              storeLat,
              storeLng,
              agent.current_location.lat,
              agent.current_location.lng,
            ),
          }))
          .sort((a, b) => a.distance - b.distance);

        if (agentsWithDistance.length > 0) {
          nextAgent = agentsWithDistance[0].agent;
          console.log(
            `Order ${orderId} force-reassigned to nearest agent ${
              nextAgent.name
            } (${agentsWithDistance[0].distance.toFixed(2)} km away)`,
          );
        } else {
          // Fallback: if no agents have location, use least assigned
          nextAgent = availableAgents.sort(
            (a, b) => a.assigned_orders - b.assigned_orders,
          )[0];
          console.log(
            `Order ${orderId} force-reassigned to agent ${nextAgent.name} (least assigned, no location data)`,
          );
        }
      } else if (availableAgents.length > 0) {
        // No store location, fallback to least assigned
        nextAgent = availableAgents.sort(
          (a, b) => a.assigned_orders - b.assigned_orders,
        )[0];
        console.log(
          `Order ${orderId} force-reassigned to agent ${nextAgent.name} (least assigned, no store location)`,
        );
      }

      let updatedOrder = null;
      if (nextAgent) {
        // Assign to next agent
        updatedOrder = await Order.findByIdAndUpdate(
          orderId,
          {
            $set: {
              "delivery.delivery_agent_id": nextAgent._id,
              "delivery.delivery_agent_response": "pending",
              "delivery.delivery_status": "assigned",
            },
            $push: {
              "delivery.assignment_history": {
                agent_id: nextAgent._id,
                assigned_at: new Date(),
                response: "pending",
              },
            },
          },
          { new: true },
        );

        // Increment agent assigned_orders counter
        await DeliveryAgent.findByIdAndUpdate(nextAgent._id, {
          $inc: { assigned_orders: 1 },
        });

        // Decrement previous agent's counter if exists (but don't go below 0)
        if (currentAgentId) {
          const currentAgent = await DeliveryAgent.findById(currentAgentId);
          if (currentAgent && currentAgent.assigned_orders > 0) {
            await DeliveryAgent.findByIdAndUpdate(currentAgentId, {
              $inc: { assigned_orders: -1 },
            });
          }
        }
      } else {
        // No agent available -> reset assignment
        updatedOrder = await Order.findByIdAndUpdate(
          orderId,
          {
            $set: {
              "delivery.delivery_agent_id": null,
              "delivery.delivery_agent_response": "pending",
              "delivery.delivery_status": "pending",
            },
          },
          { new: true },
        );

        // Decrement previous agent's counter if exists (but don't go below 0)
        if (currentAgentId) {
          const currentAgent = await DeliveryAgent.findById(currentAgentId);
          if (currentAgent && currentAgent.assigned_orders > 0) {
            await DeliveryAgent.findByIdAndUpdate(currentAgentId, {
              $inc: { assigned_orders: -1 },
            });
          }
        }
      }

      // Publish SSE
      try {
        const {
          buildEnrichedSnapshot,
        } = require("@lib/orders/snapshot");
        const snapshot = await buildEnrichedSnapshot(updatedOrder);
        publish(String(updatedOrder._id), snapshot);
        if (snapshot.seller_id)
          publishToSeller(String(snapshot.seller_id), snapshot);
        await notifyOrderUpdate(
          updatedOrder.toObject ? updatedOrder.toObject() : updatedOrder,
          snapshot,
        );
      } catch (_) {}

      res.json({
        message: nextAgent
          ? "Order force-reassigned to next agent"
          : "Order force-reassigned, no agents available (reset to pending)",
        agent: nextAgent ? { id: nextAgent._id, name: nextAgent.name } : null,
      });
    } catch (error) {
      console.error("Error force-reassigning order:", error);
      res.status(500).json({ error: "Failed to force-reassign order" });
    }
  }

  /**
   * Update order status (picked up, in transit, delivered)
   * Legacy: POST /api/delivery/update-status
   */
  async updateStatus(req, res, next) {
    try {
      const { orderId, status, agentId } = req.body;

      const updateData = {
        "delivery.delivery_status": status,
      };

      // Set timestamps based on status
      if (status === "picked_up") {
        updateData["delivery.pickup_time"] = new Date();
        updateData["delivery.estimated_delivery_time"] = new Date(
          Date.now() + 30 * 60 * 1000,
        ); // 30 minutes from now

      } else if (status === "delivered") {

        updateData["delivery.delivery_end_time"] = new Date();

        // AUTO-UPDATE PAYMENT STATUS TO PAID ON DELIVERY (COD)
        // This is the correct behavior - payment is collected when order is delivered
        updateData["payment.status"] = "paid";

        // Update agent's completed orders count
        await DeliveryAgent.findByIdAndUpdate(agentId, {
          $inc: {
            assigned_orders: -1,
            completed_orders: 1,
          },
        });

        // Persist EarningLog for seller(s) and agent upon delivery completion
        try {
          const settings = (await PlatformSettings.findOne().lean()) || {};
          const commissionRate = Number(settings.platform_commission_rate ?? 0.1);
          const agentShare = Number(settings.delivery_agent_share_rate ?? 0.8);

          const orderFull = await Order.findById(orderId).lean();
          if (orderFull) {
            const pids = (orderFull.order_items || [])
              .map((oi) => oi.product_id)
              .filter(Boolean);
            const prodMap = new Map();
            if (pids.length) {
              const prods = await Product.find(
                { _id: { $in: pids } },
                { _id: 1, seller_id: 1 },
              ).lean();
              for (const p of prods)
                prodMap.set(String(p._id), String(p.seller_id));
            }
            const sellerTotals = new Map();
            for (const oi of orderFull.order_items || []) {
              const sid = prodMap.get(String(oi.product_id));
              if (!sid) continue;
              const line = Number(oi.price_snapshot || 0) * Number(oi.qty || 0);
              sellerTotals.set(sid, (sellerTotals.get(sid) || 0) + line);
            }
            for (const [sid, itemTotal] of sellerTotals.entries()) {
              const commission = +(itemTotal * commissionRate).toFixed(2);
              const net = +(itemTotal - commission).toFixed(2);
              await EarningLog.updateOne(
                { role: "seller", order_id: orderFull._id, seller_id: sid },
                {
                  $setOnInsert: { created_at: new Date() },
                  $set: {
                    role: "seller",
                    order_id: orderFull._id,
                    seller_id: sid,
                    item_total: +itemTotal.toFixed(2),
                    platform_commission: commission,
                    net_earning: net,
                  },
                },
                { upsert: true },
              );
            }
            const delCharge = Number(orderFull.delivery?.delivery_charge || 0);
            if (agentId && delCharge > 0) {
              const agentNet = +(delCharge * agentShare).toFixed(2);
              await EarningLog.updateOne(
                { role: "delivery", order_id: orderFull._id, agent_id: agentId },
                {
                  $setOnInsert: { created_at: new Date() },
                  $set: {
                    role: "delivery",
                    order_id: orderFull._id,
                    agent_id: agentId,
                    delivery_charge: delCharge,
                    net_earning: agentNet,
                  },
                },
                { upsert: true },
              );
            }
          }
        } catch (persistErr) {
          console.error(
            "earning log persist (delivery) error",
            persistErr?.message || persistErr,
          );
        }
      }

      const updatedOrder = await Order.findByIdAndUpdate(
        orderId,
        { $set: updateData },
        { new: true },
      );

      // Publish SSE + push
      // Exclude agent (no self-notification) and seller (no repeated "new order" alerts)
      // Only notify client about delivery status changes
      try {
        const {
          buildEnrichedSnapshot,
        } = require("@lib/orders/snapshot");
        const snapshot = await buildEnrichedSnapshot(updatedOrder);
        publish(String(updatedOrder._id), snapshot);
        if (snapshot.seller_id)
          publishToSeller(String(snapshot.seller_id), snapshot); // sanitized in publisher (SSE only, no push)
        await notifyOrderUpdate(
          updatedOrder.toObject ? updatedOrder.toObject() : updatedOrder,
          snapshot,
          { excludeRoles: ["agent", "delivery", "delivery_agent", "seller"] },
        );
      } catch (_) {}

      res.json({
        message: `Order status updated to ${status}`,
        order: updatedOrder,
      });
    } catch (error) {
      console.error("Error updating order status:", error);
      res.status(500).json({ error: "Failed to update order status" });
    }
  }

  /**
   * Mark order as delivered (for delivery agent)
   * Legacy: PUT /api/delivery/mark-delivered/:orderId
   */
  async markDelivered(req, res, next) {
    try {
      const { orderId } = req.params;

      const order = await Order.findById(orderId);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Update order status and delivery status
      order.status = "delivered";
      order.delivery = order.delivery || {};
      order.delivery.delivery_status = "delivered";
      order.delivery.delivered_at = new Date();
      order.delivery.delivery_end_time = new Date();

      await order.save();

      // Publish SSE updates
      try {
        const {
          buildEnrichedSnapshot,
        } = require("@lib/orders/snapshot");
        const snapshot = await buildEnrichedSnapshot(order);
        publish(String(order._id), snapshot);
        if (snapshot.seller_id) {
          publishToSeller(String(snapshot.seller_id), snapshot);
        }
        await notifyOrderUpdate(
          order.toObject ? order.toObject() : order,
          snapshot,
          { excludeRoles: [] },
        );
      } catch (error) {
        console.log("SSE publish error (non-blocking):", error.message);
      }

      res.status(200).json({
        message: "Order marked as delivered successfully",
        order: order,
      });
    } catch (error) {
      console.error("Error marking order as delivered:", error);
      res.status(500).json({ error: "Failed to mark order as delivered" });
    }
  }
}

module.exports = new OrdersController();

/**
 * RouteController - delivery agent API (mounted at /api/delivery).
 * Handler bodies copied verbatim from legacy routes/delivery.js; only require paths changed.
 */
const mongoose = require("mongoose");
const { Order, DeliveryAgent } = require("@models");

// Simple in-memory cache for route optimization results (key -> { data, exp })
const _routeCache = new Map();
const ROUTE_CACHE_TTL_MS = 60 * 1000; // 60s

class RouteController {
  /**
   * ---------------- Route Optimization ----------------
   * POST /api/delivery/:agentId/route/optimize
   * Body: { order_ids?: [string], points?: [{lat,lng,type,label?}], allowReorder?: bool, profile?: 'driving', avoid?: {tolls?:bool, highways?:bool} }
   * Legacy: POST /api/delivery/:agentId/route/optimize
   */
  async optimize(req, res, next) {
    try {
      const { agentId } = req.params;
      if (!agentId || !mongoose.isValidObjectId(agentId)) {
        return res.status(400).json({ error: "valid agentId required" });
      }
      const agent = await DeliveryAgent.findById(agentId)
        .select("active current_location")
        .lean();
      if (!agent || agent.active !== true) {
        return res.status(400).json({ error: "agent not active" });
      }
      const { order_ids, points, allowReorder = true } = req.body || {};
      if (
        (!Array.isArray(order_ids) || order_ids.length === 0) &&
        (!Array.isArray(points) || points.length === 0)
      ) {
        return res
          .status(400)
          .json({ error: "order_ids[] or points[] required" });
      }
      const maxStops = 10;

      // Build canonical cache key
      const keyObj = {
        agentId,
        order_ids: order_ids || null,
        points: points || null,
        allowReorder,
      }; // omit avoid/profile for now
      const cacheKey = JSON.stringify(keyObj);
      const now = Date.now();
      const hit = _routeCache.get(cacheKey);
      if (hit && hit.exp > now) {
        return res.json({ ...hit.data, cached: true });
      }

      // Resolve waypoints
      const stops = []; // {type, lat, lng, label?, order_id?}
      // Agent origin
      let agentLoc = null;
      if (
        agent.current_location &&
        agent.current_location.lat != null &&
        agent.current_location.lng != null
      ) {
        agentLoc = {
          lat: Number(agent.current_location.lat),
          lng: Number(agent.current_location.lng),
        };
      }
      if (!agentLoc) {
        // Fallback to first point or 0,0 (will be filtered); no geolocation from server side for privacy
        agentLoc = { lat: 0, lng: 0 };
      }
      stops.push({
        type: "agent",
        lat: agentLoc.lat,
        lng: agentLoc.lng,
        label: "Agent",
      });

      if (Array.isArray(order_ids) && order_ids.length) {
        // Fetch orders and extract pickup/dropoff
        const orders = await Order.find({ _id: { $in: order_ids } })
          .select(
            "delivery.delivery_address seller_id seller restaurant order_items",
          )
          .populate("seller_id", "business_name location")
          .lean();
        for (const o of orders) {
          if (stops.length >= maxStops * 2) break; // crude cap
          // Pickup: seller or restaurant location
          let pickup = null;
          const sellerLoc =
            o?.seller_id?.location ||
            o?.seller?.location ||
            o?.restaurant_id?.location ||
            o?.restaurant?.location;
          if (sellerLoc && sellerLoc.lat != null && sellerLoc.lng != null) {
            pickup = { lat: Number(sellerLoc.lat), lng: Number(sellerLoc.lng) };
          }
          // Dropoff: delivery address location
          let drop = null;
          const deliveryLoc = o?.delivery?.delivery_address?.location;
          if (deliveryLoc && deliveryLoc.lat != null && deliveryLoc.lng != null) {
            drop = { lat: Number(deliveryLoc.lat), lng: Number(deliveryLoc.lng) };
          }
          if (pickup) {
            stops.push({
              type: "pickup",
              lat: pickup.lat,
              lng: pickup.lng,
              label: "Pickup",
              order_id: o._id,
            });
          }
          if (drop) {
            stops.push({
              type: "dropoff",
              lat: drop.lat,
              lng: drop.lng,
              label: "Drop",
              order_id: o._id,
            });
          }
        }
      } else if (Array.isArray(points)) {
        for (const p of points) {
          if (!p || p.lat == null || p.lng == null) continue;
          stops.push({
            type: p.type || "waypoint",
            lat: Number(p.lat),
            lng: Number(p.lng),
            label: p.label,
            order_id: p.order_id,
          });
          if (stops.length >= maxStops + 1) break;
        }
      }

      // Filter invalid coordinates
      const validStops = stops.filter(
        (s) => Number.isFinite(s.lat) && Number.isFinite(s.lng),
      );
      if (validStops.length < 2) {
        return res.status(400).json({ error: "insufficient valid stops" });
      }

      // Build simple distance matrix (Haversine) for fallback ordering
      function haversine(a, b) {
        const R = 6371; // km
        const dLat = ((b.lat - a.lat) * Math.PI) / 180;
        const dLng = ((b.lng - a.lng) * Math.PI) / 180;
        const lat1 = (a.lat * Math.PI) / 180;
        const lat2 = (b.lat * Math.PI) / 180;
        const h =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 1000; // meters
      }

      let ordered = validStops.slice();
      let engine = "fallback";
      let warnings = [];
      // Simple nearest-neighbor if allowReorder and >2 stops
      if (allowReorder && ordered.length > 2) {
        const origin = ordered[0];
        const remaining = ordered.slice(1);
        const seq = [origin];
        let current = origin;
        while (remaining.length) {
          remaining.sort((a, b) => haversine(current, a) - haversine(current, b));
          const next = remaining.shift();
          seq.push(next);
          current = next;
        }
        ordered = seq;
      }

      // Compute legs distances
      const legs = [];
      let totalDist = 0;
      for (let i = 0; i < ordered.length - 1; i++) {
        const a = ordered[i];
        const b = ordered[i + 1];
        const d = haversine(a, b);
        totalDist += d;
        // Duration rough estimate: 40km/h -> 11.11 m/s
        const durSec = Math.round(d / 11.11);
        legs.push({
          from_index: i,
          to_index: i + 1,
          distance_m: Math.round(d),
          duration_s: durSec,
        });
      }
      const totalDuration = legs.reduce((s, l) => s + l.duration_s, 0);

      // Build a crude polyline (GeoJSON LineString) from ordered stops
      const geojson = {
        type: "LineString",
        coordinates: ordered.map((s) => [s.lng, s.lat]),
      };

      const out = {
        ordered_stops: ordered,
        total_distance_m: Math.round(totalDist),
        total_duration_s: totalDuration,
        legs,
        polyline: null, // Could add encoded polyline if calling Google/OSRM later
        geojson,
        diagnostics: { engine, warnings },
      };

      _routeCache.set(cacheKey, { data: out, exp: now + ROUTE_CACHE_TTL_MS });
      res.json(out);
    } catch (e) {
      console.error("route optimize error", e);
      res.status(500).json({ error: "failed to optimize route" });
    }
  }
}

module.exports = new RouteController();

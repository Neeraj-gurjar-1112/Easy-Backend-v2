# Delivery Agent Availability Warning Feature

## Overview

This feature displays a warning message to users during order placement when no delivery agents are currently available, helping manage user expectations about potential delivery delays.

## User Experience Flow

### Normal Flow (Agents Available)

1. User proceeds to checkout from cart
2. User selects delivery address
3. User taps "Place Order"
4. System checks agent availability (transparent, fast)
5. Order is placed immediately
6. User sees order confirmation

### Warning Flow (No Agents Available)

1. User proceeds to checkout from cart
2. User selects delivery address
3. User taps "Place Order"
4. System checks agent availability
5. **Warning dialog appears:**
   - Icon: ⚠️ Orange warning icon
   - Title: "Delivery May Be Delayed"
   - Message: "Your order may be delayed as all delivery partners are currently busy. Do you want to place your order anyway?"
   - Actions:
     - **Cancel**: Returns to address selection, order not placed
     - **Place Order Anyway**: Continues with order placement
6. If user confirms, order is placed
7. User sees order confirmation

## Implementation Details

### Backend Changes

**File:** `Backend/routes/delivery.js`

**New Endpoint:** `GET /api/delivery/check-availability`

```javascript
// Public endpoint to check delivery agent availability
router.get("/check-availability", async (req, res) => {
  try {
    const count = await DeliveryAgent.countDocuments({
      approved: true,
      active: true,
      available: true,
    });
    res.json({ available: count > 0, count });
  } catch (error) {
    console.error("Error checking delivery agent availability:", error);
    // Default to available on error to not block orders
    res.json({ available: true, count: 0 });
  }
});
```

**Response Format:**

```json
{
  "available": true, // false if no agents available
  "count": 5 // number of available agents
}
```

**Criteria for "Available":**

- `approved: true` - Agent has been approved by admin
- `active: true` - Agent is currently active/online
- `available: true` - Agent is not currently on a delivery

**Error Handling:**

- If database query fails, defaults to `available: true` to not block orders
- Fail-open approach ensures system availability

### Frontend Changes

#### API Service

**File:** `Frontend/lib/services/api_service.dart`

**New Method:** `checkDeliveryAgentAvailability()`

```dart
static Future<Map<String, dynamic>> checkDeliveryAgentAvailability() async {
  final uri = Uri.parse('$baseUrl/api/delivery/check-availability');
  try {
    final res = await http.get(uri).timeout(_requestTimeout);
    if (res.statusCode >= 200 && res.statusCode < 300) {
      final decoded = jsonDecode(res.body);
      return decoded is Map<String, dynamic> ? decoded : {'available': true, 'count': 0};
    }
    return {'available': true, 'count': 0};
  } on TimeoutException {
    return {'available': true, 'count': 0};
  } catch (e) {
    return {'available': true, 'count': 0};
  }
}
```

**Error Handling:**

- Timeout: Returns available = true (fail open)
- Network error: Returns available = true (fail open)
- Invalid response: Returns available = true (fail open)

#### Order Placement Screen

**File:** `Frontend/lib/screens/address_selection_screen.dart`

**Location:** Before `api.createOrder()` call

**Implementation:**

```dart
// Check delivery agent availability and show warning if needed
try {
  final availability = await api.checkDeliveryAgentAvailability();
  if (availability['available'] == false) {
    if (!mounted) return;
    final proceed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: Row(
          children: const [
            Icon(Icons.warning_amber_rounded, color: Colors.orange, size: 28),
            Expanded(
              child: Text('Delivery May Be Delayed', style: TextStyle(fontSize: 18)),
            ),
          ],
        ),
        content: const Text(
          'Your order may be delayed as all delivery partners are currently busy. '
          'Do you want to place your order anyway?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: Colors.orange),
            child: const Text('Place Order Anyway'),
          ),
        ],
      ),
    );
    if (proceed != true) {
      setState(() => _processing = false);
      return; // User cancelled
    }
  }
} catch (e) {
  // If check fails, allow order to proceed (fail open)
  debugPrint('Failed to check agent availability: $e');
}
```

## Design Decisions

### 1. Fail-Open Philosophy

**Decision:** If the availability check fails, allow orders to proceed.

**Rationale:**

- Network issues shouldn't block legitimate orders
- Better to accept orders and handle delays than lose business
- Backend will still attempt agent assignment as usual
- Users get service even during system hiccups

### 2. Pre-Order Check

**Decision:** Check availability BEFORE creating the order.

**Rationale:**

- Better user experience (user knows before committing)
- User can choose to cancel and try later
- No orphaned orders in the system
- Clear communication of potential delays

**Alternative Considered:** Check after order creation

- **Rejected:** Creates confusion, harder to cancel
- Orders would be created even if user wants to wait

### 3. Warning Dialog Design

**Decision:** Modal dialog with explicit confirmation.

**Rationale:**

- Ensures user sees and acknowledges the warning
- Clear call-to-action buttons
- Non-dismissible (must choose an action)
- Orange color indicates caution without being alarming

### 4. Agent Availability Criteria

**Decision:** Require approved, active, AND available status.

**Rationale:**

- `approved`: Only vetted agents should be counted
- `active`: Only online agents can accept deliveries
- `available`: Only agents not on current delivery can take new orders

### 5. Public Endpoint

**Decision:** No authentication required for availability check.

**Rationale:**

- Check happens before user commits to order
- No sensitive information exposed (just a count)
- Reduces API complexity
- Faster response time

## Performance Considerations

### Database Query Optimization

```javascript
DeliveryAgent.countDocuments({
  approved: true,
  active: true,
  available: true,
});
```

**Efficiency:**

- Uses `countDocuments()` instead of `find()` (faster)
- Compound index recommended: `{approved: 1, active: 1, available: 1}`
- Query returns immediately (no document hydration)

**Recommended Index:**

```javascript
db.deliveryagents.createIndex({
  approved: 1,
  active: 1,
  available: 1,
});
```

### Caching Considerations

**Current:** No caching (real-time check)

**Future Enhancement:** Could cache for 10-30 seconds to reduce database load during high traffic.

**Trade-off:** Real-time accuracy vs. performance

## Testing Scenarios

### Manual Testing

#### Test 1: No Agents Available

1. In admin dashboard, set all agents to `available: false` or `active: false`
2. As user, add items to cart
3. Proceed to checkout
4. Select delivery address
5. Tap "Place Order"
6. **Expected:** Warning dialog appears
7. Tap "Cancel"
8. **Expected:** Return to address selection, order not created
9. Tap "Place Order" again
10. Tap "Place Order Anyway" in dialog
11. **Expected:** Order created successfully

#### Test 2: Agents Available

1. Ensure at least one agent has `approved: true, active: true, available: true`
2. As user, proceed to checkout
3. Select address and tap "Place Order"
4. **Expected:** No warning, order placed immediately

#### Test 3: Network Failure

1. Disconnect network or stop backend
2. Attempt to place order
3. **Expected:** Order proceeds (fail-open)
4. Check console for debug message

#### Test 4: Timeout

1. Add artificial delay in backend endpoint (>30s)
2. Attempt to place order
3. **Expected:** After timeout, order proceeds

### Automated Testing

**Backend Test:**

```javascript
describe("GET /api/delivery/check-availability", () => {
  it("returns available=true when agents exist", async () => {
    await DeliveryAgent.create({
      approved: true,
      active: true,
      available: true,
      // ... other fields
    });
    const res = await request(app).get("/api/delivery/check-availability");
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.count).toBe(1);
  });

  it("returns available=false when no agents exist", async () => {
    const res = await request(app).get("/api/delivery/check-availability");
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.count).toBe(0);
  });
});
```

## Future Enhancements

### 1. Estimated Delay Time

Instead of generic "may be delayed", show:

- "Expected delay: 15-30 minutes"
- Based on average assignment time when all agents busy

### 2. Agent ETA

If agents are busy but expected to be free soon:

- "2 delivery partners will be available in ~10 minutes"

### 3. Peak Hours Warning

During known busy times:

- "This is a peak time. Deliveries may take longer than usual."

### 4. Real-Time Updates

After order placement:

- Live updates on agent assignment progress
- "Searching for available delivery partner..."
- "Delivery partner found and on the way to pick up your order"

### 5. Pre-Booking Option

When no agents available:

- "Schedule delivery for later when more agents are available"
- Allow users to choose a future time slot

### 6. Alternative Pickup Option

- "No delivery available? Pick up from store instead"
- Switch to pickup mode

## Monitoring & Analytics

### Metrics to Track

1. **Warning Display Rate**
   - How often users see the warning
   - Peak times with no agents available

2. **User Behavior After Warning**
   - % who cancel vs. proceed
   - Impact on order completion rate

3. **Actual Delay Times**
   - Compare warned orders vs. normal orders
   - Validate warning accuracy

4. **Agent Utilization**
   - Times when all agents are busy
   - Need for more agents during those times

### Dashboard Queries

**Orders placed during no-agent-available periods:**

```javascript
db.orders
  .find({
    createdAt: { $gte: ISODate("..."), $lte: ISODate("...") },
  })
  .count();
```

**Average assignment time when warning shown:**

```javascript
// Compare delivery.assigned_at - order.createdAt
// for orders during busy periods
```

## Rollout Plan

### Phase 1: Silent Logging (Current)

- Feature deployed but only logs internally
- No user-facing changes yet
- Collect baseline metrics

### Phase 2: Soft Launch (Recommended Next)

- Enable for 10% of orders
- Monitor user behavior and feedback
- Adjust messaging if needed

### Phase 3: Full Rollout

- Enable for all users
- Monitor performance and errors
- Iterate based on feedback

### Phase 4: Enhancements

- Add estimated delay times
- Implement real-time updates
- Add alternative options (pickup, schedule)

## Support & Troubleshooting

### Common Issues

**Issue:** Warning shows but agents are actually available

- **Cause:** Database not updated in real-time
- **Solution:** Check agent status manually, verify database state

**Issue:** No warning but orders aren't being assigned

- **Cause:** Agents available but other criteria failing (distance, capacity)
- **Solution:** This warning only checks base availability, not assignment logic

**Issue:** Warning shows too frequently

- **Cause:** Not enough agents during peak hours
- **Solution:** Operational issue, recruit more agents or adjust shifts

### Debug Commands

**Check agent status in database:**

```javascript
db.deliveryagents
  .find({
    approved: true,
    active: true,
    available: true,
  })
  .count();
```

**View recent availability checks (if logging added):**

```bash
grep "check-availability" logs/app.log | tail -20
```

## Security Considerations

### Information Disclosure

**Risk:** Low

- Only exposes count of available agents
- No personal information
- No location data
- No business-critical secrets

### DoS Protection

**Current:** None
**Recommendation:** Rate limiting

```javascript
const rateLimit = require("express-rate-limit");

const availabilityLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per IP
  message: "Too many availability checks, please try again later",
});

router.get("/check-availability", availabilityLimiter, async (req, res) => {
  // ... existing code
});
```

## Conclusion

This feature improves transparency and user experience by setting clear expectations about delivery times when the system is under high load. The fail-open design ensures orders can still be placed even if the check fails, prioritizing business continuity while adding value when the system is operating normally.

**Benefits:**

- ✅ Better user expectations
- ✅ Reduced support tickets about delays
- ✅ User choice (cancel vs. proceed)
- ✅ No blocking of legitimate orders
- ✅ Simple, performant implementation

**Key Success Metrics:**

- User satisfaction with delivery time transparency
- Reduction in "where's my order" support tickets
- Order completion rate (should not decrease)
- Agent utilization insights for operations team

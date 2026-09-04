# Test status

`npm test` currently reports **~1300 failing tests across 46 suites**. Every one of those
failures also happens in the old backend with the same code. The restructure did not break
them; the suite had already drifted away from the code before v2 existed.

The repo's own `LATEST_TEST_RESULTS_SUMMARY.md` (kept in `docs/legacy/`) reports 66/66 suites
green on 19 Dec 2025. Schema and endpoint changes landed after that date and the tests were
never updated.

## Evidence that the failures are pre-existing

| check | result |
|---|---|
| Same 6 representative suites run against the old backend and against v2 | identical: **108 failed / 75 passed / 183 total** on both |
| All 18 Mongoose schemas compared field-by-field (paths, types, required/unique, enums, indexes, hooks, methods, collection names) | identical |
| Copied `lib/` modules diffed against their originals (`middleware/*`, `push`, `geocode`, `pricing`, `messageCentral`, `validation`, …) | byte-identical apart from `require` paths |
| Route table of both apps (`node scripts/list-routes.js`) | identical 194 endpoints |
| 174 live request/response pairs replayed against both apps on identically seeded databases | **174/174 identical** status + body |

## What the failures actually are

| cause | failures | why |
|---|---|---|
| `Seller validation failed: address / location.lat / location.lng required` | ~2190 | Those fields were made **required** on the Seller schema after the tests were written. Many fixtures build a seller with only name/email/phone/business_type, so `beforeAll` throws and every test in the block fails. `tests/testUtils/mockData.js#generateMockSeller` does include them, which is why the suites using it still pass. |
| `401 Unauthorized` | 60 | `tests/controllers/clientsController.test.js` never sends an `Authorization` header, but `/api/clients` has been JWT-protected (`router.use(verifyToken)`) in both versions. |
| `404 Not Found` | 26 | Tests exercise `POST /api/auth/map-by-email`, which no longer exists in either version. |
| Firebase middleware assertions | ~55 | `firebase_auth_middleware.test.js` and `middleware/verifyFirebaseToken.test.js` test Firebase ID-token verification. Auth was replaced by custom JWT long before v2; only FCM still uses Firebase. |
| `BSONError: input must be a 24 character hex string` | 6 | `uploads_comprehensive.test.js` expects uploads in GridFS and parses the response id as an ObjectId. Uploads are written to the local `uploads/` folder, so the id is a filename. |
| OTP sanitisation in SSE payloads | 4 | `services/orderEvents.test.js` expects `publishToSeller` to strip `delivery.otp_code`. Neither version sanitises (only a stale comment in the seller route claims it does). |
| cascade failures (`Cannot read properties of undefined`) | 18 | Follow-on errors inside blocks whose `beforeAll` already failed for one of the reasons above. |

## Fixed as part of the restructure

`tests/error_handlers_isolated.test.js` had two tests that read `routes/products.js` /
`routes/restaurants.js` from disk and asserted on **hardcoded line indices** (`lines[58]`).
No refactor can survive that. They now read the corresponding v2 controller and locate the
handler by its log message.

## Running the suite

```bash
npm test                       # jest, coverage on
npx jest tests/products.test.js --coverage=false
```

`tests/testUtils/dbHandler.js` uses `DB_CONNECTION_STRING` (writing to a `grocery_db_test`
database) when it is set, and otherwise starts an in-process MongoDB via
`mongodb-memory-server`, so the suite runs with no external database.

## Suggested clean-up (separate from the restructure)

1. Route every seller fixture through `generateMockSeller` (or add `address` + `location` to the
   inline ones). That alone clears roughly 85% of the failures.
2. Give `clientsController.test.js` a signed JWT.
3. Delete the Firebase-auth suites, or rewrite them against `lib/middleware/auth.js`.
4. Point the upload tests at the disk-storage behaviour, or restore GridFS.
5. Drop the `map-by-email` tests, or re-add the endpoint if the apps still call it.

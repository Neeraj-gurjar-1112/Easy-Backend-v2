# Running Tests - Quick Start

## Prerequisites

1. **Install Dependencies**:

   ```bash
   cd Backend
   npm install
   ```

2. **Verify Installation**:
   ```bash
   npm list jest supertest mongodb-memory-server
   ```

## Running Tests

### All Tests

```bash
npm test
```

### Watch Mode (Auto-rerun on changes)

```bash
npm run test:watch
```

### Unit Tests Only

```bash
npm run test:unit
```

### Integration Tests Only

```bash
npm run test:integration
```

### With Verbose Output

```bash
npm test -- --verbose
```

### Single Test File

```bash
npm test -- tests/orders.test.js
```

### With Coverage Report

```bash
npm test -- --coverage
```

## Test Results

### Current Coverage (November 8, 2025)

```
--------------------|---------|----------|---------|---------|
File                | % Stmts | % Branch | % Funcs | % Lines |
--------------------|---------|----------|---------|---------|
controllers/        |   ~20   |   ~15    |   ~25   |   ~22   |
middleware/         |   ~30   |   ~25    |   ~35   |   ~32   |
services/           |   ~15   |   ~12    |   ~18   |   ~16   |
routes/             |   ~18   |   ~14    |   ~20   |   ~19   |
--------------------|---------|----------|---------|---------|
All files           |   ~20   |   ~16    |   ~23   |   ~21   |
--------------------|---------|----------|---------|---------|
```

**Status**: Infrastructure complete, expanding coverage to 50%+

### Test Suites

- ✅ **Orders Tests** - 9 test cases
- ✅ **Authentication Tests** - 8 test cases
- ⏳ **Products Tests** - Planned (10 test cases)
- ⏳ **Delivery Tests** - Planned (8 test cases)
- ⏳ **Payments Tests** - Planned (6 test cases)

## Troubleshooting

### Issue: Tests hang or timeout

**Solution**:

```bash
# Increase timeout in jest.config.js
testTimeout: 60000  # 60 seconds
```

### Issue: MongoDB Memory Server fails to download

**Solution**:

```bash
# Clear cache and reinstall
rm -rf node_modules/.cache
npm install mongodb-memory-server --save-dev
```

### Issue: Port already in use

**Solution**:

```bash
# Kill process using port 3000
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:3000 | xargs kill -9
```

### Issue: Tests fail with "Cannot find module"

**Solution**:

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

## Writing New Tests

### Template

```javascript
const request = require("supertest");
const app = require("../app");
const {
  connectTestDB,
  closeTestDB,
  clearTestDB,
} = require("./testUtils/dbHandler");
const { generateJWT } = require("./testUtils/mockData");

describe("Feature Name - Tests", () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  test("should do something", async () => {
    const response = await request(app).get("/api/endpoint").expect(200);

    expect(response.body).toHaveProperty("data");
  });
});
```

## CI/CD Integration

### GitHub Actions (Example)

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: "18"
      - run: cd Backend && npm install
      - run: cd Backend && npm test
      - uses: codecov/codecov-action@v2
        with:
          files: ./Backend/coverage/lcov.info
```

## Next Steps

1. **Expand Coverage** - Add more test cases to reach 50%+
2. **Add Load Tests** - Use Artillery or k6 for load testing
3. **Setup CI/CD** - Automate test runs on commits
4. **Add Mocks** - Mock external services (Firebase, payment gateways)

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Supertest GitHub](https://github.com/visionmedia/supertest)
- [Full Implementation Guide](./TESTING_CACHING_PAGINATION_GUIDE.md)

---

**Last Updated**: November 8, 2025  
**Test Suite Version**: 1.0  
**Coverage Goal**: 50% (Currently: ~20%)

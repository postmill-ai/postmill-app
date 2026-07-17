#!/bin/bash
set -e

echo "=========================================="
echo "POSTIZ E2E COMPREHENSIVE UI TEST SUITE"
echo "=========================================="
echo ""

# Clean previous results
rm -f results-*.json ui-*.png

echo "📋 Running comprehensive test suite..."
echo "   30 - Analytics page"
echo "   31 - Composer flows"
echo "   32 - Settings pages"
echo "   33 - Media library"
echo "   35 - Error states"
echo "   36 - Post detail"
echo ""

# Run tests in Docker with Playwright
docker run --rm \
  --network=host \
  -v "$(pwd):/e2e" \
  -w /e2e \
  -e CI=1 \
  mcr.microsoft.com/playwright:v1.58.2-jammy \
  bash -c "
    npm install -g pnpm > /dev/null 2>&1
    npx playwright test \
      30-ui-analytics.spec.ts \
      31-ui-composer-flows.spec.ts \
      32-ui-settings.spec.ts \
      33-ui-media-library.spec.ts \
      35-ui-error-states.spec.ts \
      36-ui-post-detail.spec.ts \
      2>&1
  "

echo ""
echo "=========================================="
echo "TEST EXECUTION COMPLETE"
echo "=========================================="
echo ""

# Aggregate results
if [ -f "results-analytics.json" ]; then
  echo "✓ Analytics test completed"
fi
if [ -f "results-composer-flows.json" ]; then
  echo "✓ Composer flows test completed"
fi
if [ -f "results-settings.json" ]; then
  echo "✓ Settings test completed"
fi
if [ -f "results-media.json" ]; then
  echo "✓ Media library test completed"
fi
if [ -f "results-errors.json" ]; then
  echo "✓ Error states test completed"
fi
if [ -f "results-post-detail.json" ]; then
  echo "✓ Post detail test completed"
fi

echo ""
echo "📊 Full test results available in:"
echo "   - results-*.json files (structured data)"
echo "   - ui-*.png files (screenshots)"
echo "   - playwright-report/ directory (HTML report)"

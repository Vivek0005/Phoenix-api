const sampleNames = [
    "The Nightingale",
    "The Kraken",
    "The Phantom",
    "The Chimera",
    "The Shadow",
    "The Wraith",
    "The Viper",
    "The Falcon"
];

function generateCodename() {
    const idx = Math.floor(Math.random() * sampleNames.length)
    return sampleNames[idx];
}

module.exports = generateCodename;


---- -++++ ------

    Here's everything clean and complete.

---

## Folder Structure To Create

```
bos-nrt/
├── .github/
│   └── workflows/
│       └── nrt.yml
├── testApi/
│   └── bos-contract-service/
│       ├── request/
│       │   ├── healthCheck_request.json
│       │   └── currencyApi_request.json
│       └── response/
│           ├── healthCheck_response.json
│           └── currencyApi_response.json
├── nrt-runner.sh
└── README.md
```

---

## File 1 — `.github/workflows/nrt.yml`

```yaml
name: NRT - Non Regression Tests

on:
  workflow_dispatch:
    inputs:

      environment:
        description: 'Target environment'
        required: true
        type: choice
        options:
          - dev
          - uat

      auth_token_contract:
        description: 'Bearer token for contract-service (copy from Swagger)'
        required: true
        type: string

      auth_token_access:
        description: 'Bearer token for access-management (copy from Swagger)'
        required: true
        type: string

jobs:
  nrt:
    runs-on: [self-hosted, linux]

    steps:

      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Set Base URL
        run: |
          if [ "${{ inputs.environment }}" = "dev" ]; then
            echo "BASE_URL=https://bo-services-dev.fr.world.socgen" >> $GITHUB_ENV
          else
            echo "BASE_URL=https://bo-services-uat.fr.world.socgen" >> $GITHUB_ENV
          fi

      - name: Run NRT
        env:
          AUTH_TOKEN_CONTRACT: ${{ inputs.auth_token_contract }}
          AUTH_TOKEN_ACCESS: ${{ inputs.auth_token_access }}
          ENVIRONMENT: ${{ inputs.environment }}
        run: bash nrt-runner.sh
```

---

## File 2 — `nrt-runner.sh`

```bash
#!/bin/bash

# ═══════════════════════════════════════════════════════════
# NRT Runner — Non Regression Test Engine
# ═══════════════════════════════════════════════════════════
#
# WHAT IT DOES:
# 1. Validates both tokens against tokeninfo endpoint
# 2. Prints user metadata from access-management service
# 3. Iterates over all request/response JSON files
# 4. Fires curl requests and compares responses
# 5. Prints clean pass/fail summary with diffs
#
# VALIDATION MODES:
#   EXACT    → every field must match exactly
#   CONTAINS → expected fields must match, extras ignored
#   IGNORE   → strip listed fields, compare rest
#   EXISTS   → only check listed fields exist, values ignored
#
# HOW TO RUN LOCALLY:
#   export AUTH_TOKEN_CONTRACT=your_token
#   export AUTH_TOKEN_ACCESS=your_token
#   export BASE_URL=https://bo-services-dev.fr.world.socgen
#   export ENVIRONMENT=dev
#   bash nrt-runner.sh
# ═══════════════════════════════════════════════════════════

set -o pipefail

# ── CONSTANTS ─────────────────────────────────────────────
TOKENINFO_URL="https://sgconnect-hom.fr.world.socgen/sgconnect/oauth2/tokeninfo"
CURL_TIMEOUT=30
PASSED=0
FAILED=0
FAILED_DETAILS=""

# ── HELPERS ───────────────────────────────────────────────

add_summary() {
  if [ -n "$GITHUB_STEP_SUMMARY" ]; then
    echo "$1" >> "$GITHUB_STEP_SUMMARY"
  fi
}

print_header() {
  echo ""
  echo "=========================================="
  echo "  $1"
  echo "=========================================="
}

print_divider() {
  echo "──────────────────────────────────────────"
}

# ── STEP 1: VALIDATE INPUTS ───────────────────────────────

print_header "INPUT VALIDATION"

if [ -z "$AUTH_TOKEN_CONTRACT" ]; then
  echo "ERROR: AUTH_TOKEN_CONTRACT is not set"
  exit 1
fi

if [ -z "$AUTH_TOKEN_ACCESS" ]; then
  echo "ERROR: AUTH_TOKEN_ACCESS is not set"
  exit 1
fi

if [ -z "$BASE_URL" ]; then
  echo "ERROR: BASE_URL is not set"
  exit 1
fi

echo ">> Environment : ${ENVIRONMENT:-local}"
echo ">> Base URL    : $BASE_URL"
echo ">> Inputs      : OK ✓"

# ── STEP 2: VALIDATE TOKENS ───────────────────────────────

print_header "TOKEN VALIDATION"

# ── Validate contract-service token ──
echo ""
echo ">> Validating contract-service token..."

CONTRACT_INFO=$(curl -s \
  --max-time $CURL_TIMEOUT \
  "${TOKENINFO_URL}?access_token=${AUTH_TOKEN_CONTRACT}")

if [ -z "$CONTRACT_INFO" ]; then
  echo "ERROR: Could not reach tokeninfo endpoint for contract-service token"
  exit 1
fi

if ! echo "$CONTRACT_INFO" | jq . > /dev/null 2>&1; then
  echo "ERROR: tokeninfo returned invalid JSON for contract-service token"
  echo "Raw: $CONTRACT_INFO"
  exit 1
fi

CONTRACT_ERROR=$(echo "$CONTRACT_INFO" | jq -r '.error // empty')
if [ -n "$CONTRACT_ERROR" ]; then
  echo "ERROR: contract-service token is invalid or expired"
  echo "Details: $(echo "$CONTRACT_INFO" | \
    jq -r '.error_description // .error')"
  exit 1
fi

USER_EMAIL=$(echo "$CONTRACT_INFO" | \
  jq -r '.subname // .sub // .email // empty')

if [ -z "$USER_EMAIL" ]; then
  echo "ERROR: Could not extract user email from contract-service token"
  exit 1
fi

CONTRACT_EXPIRES=$(echo "$CONTRACT_INFO" | \
  jq -r '.expires_in // "unknown"')

echo ">> contract-service token : VALID ✓"
echo ">> Expires in             : ${CONTRACT_EXPIRES}s"
echo ">> User Email             : $USER_EMAIL"

# ── Validate access-management token ──
echo ""
echo ">> Validating access-management token..."

ACCESS_INFO=$(curl -s \
  --max-time $CURL_TIMEOUT \
  "${TOKENINFO_URL}?access_token=${AUTH_TOKEN_ACCESS}")

if [ -z "$ACCESS_INFO" ]; then
  echo "ERROR: Could not reach tokeninfo endpoint for access-management token"
  exit 1
fi

if ! echo "$ACCESS_INFO" | jq . > /dev/null 2>&1; then
  echo "ERROR: tokeninfo returned invalid JSON for access-management token"
  echo "Raw: $ACCESS_INFO"
  exit 1
fi

ACCESS_ERROR=$(echo "$ACCESS_INFO" | jq -r '.error // empty')
if [ -n "$ACCESS_ERROR" ]; then
  echo "ERROR: access-management token is invalid or expired"
  echo "Details: $(echo "$ACCESS_INFO" | \
    jq -r '.error_description // .error')"
  exit 1
fi

ACCESS_EXPIRES=$(echo "$ACCESS_INFO" | \
  jq -r '.expires_in // "unknown"')

echo ">> access-management token: VALID ✓"
echo ">> Expires in             : ${ACCESS_EXPIRES}s"

# ── STEP 3: PRINT USER METADATA ───────────────────────────

print_header "USER METADATA"

ENCODED_EMAIL=$(echo "$USER_EMAIL" | sed 's/@/%40/g')

USER_INFO=$(curl -s \
  --max-time $CURL_TIMEOUT \
  -H "accept: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN_ACCESS" \
  "${BASE_URL}/access-management-service/api/v1/users/${ENCODED_EMAIL}")

if [ -z "$USER_INFO" ]; then
  echo "WARNING: Could not fetch user metadata. Continuing..."
elif ! echo "$USER_INFO" | jq . > /dev/null 2>&1; then
  echo "WARNING: User metadata response is not valid JSON. Continuing..."
else
  USER_ERROR=$(echo "$USER_INFO" | jq -r '.error // empty')
  if [ -n "$USER_ERROR" ]; then
    echo "WARNING: Could not fetch user metadata: $USER_ERROR"
    echo "Continuing with NRT tests..."
  else
    GIVEN_NAME=$(echo "$USER_INFO" | jq -r '.givenName // "N/A"')
    SURNAME=$(echo "$USER_INFO" | jq -r '.surname // "N/A"')
    DEPARTMENT=$(echo "$USER_INFO" | jq -r '.department // "N/A"')
    IGG=$(echo "$USER_INFO" | jq -r '.igg // "N/A"')

    echo ""
    echo ">> Name       : $GIVEN_NAME $SURNAME"
    echo ">> Email      : $USER_EMAIL"
    echo ">> Department : $DEPARTMENT"
    echo ">> IGG        : $IGG"
    echo ""
    echo ">> Privilege Groups:"
    echo "$USER_INFO" | jq -r '.privilegeGroups[]? // empty' | \
      while read -r group; do echo "   - $group"; done
    echo ""
    echo ">> Roles:"
    echo "$USER_INFO" | jq -r '.roles[]? // empty' | \
      while read -r role; do echo "   - $role"; done
  fi
fi

# ── STEP 4: RUN NRT TESTS ─────────────────────────────────

print_header "NRT TEST EXECUTION"

if [ ! -d "testApi" ]; then
  echo "ERROR: testApi folder not found."
  echo "Create testApi/<service>/request/ and response/ folders."
  exit 1
fi

add_summary "# NRT Test Results"
add_summary "**Environment:** ${ENVIRONMENT:-local} | **Base URL:** $BASE_URL | **User:** $USER_EMAIL"
add_summary ""

for SERVICE_DIR in testApi/*/; do

  if [ ! -d "$SERVICE_DIR" ]; then
    echo "WARNING: No service folders found in testApi/"
    break
  fi

  SERVICE_NAME=$(basename "$SERVICE_DIR")
  REQUEST_DIR="${SERVICE_DIR}request"
  RESPONSE_DIR="${SERVICE_DIR}response"

  echo ""
  print_divider
  echo "  Service: $SERVICE_NAME"
  print_divider

  add_summary "## $SERVICE_NAME"
  add_summary "| Test | Status | Time | Details |"
  add_summary "|------|--------|------|---------|"

  if [ ! -d "$REQUEST_DIR" ]; then
    echo "WARNING: No request folder found. Skipping $SERVICE_NAME"
    add_summary "| - | ⚠️ SKIP | - | No request folder |"
    continue
  fi

  if [ ! -d "$RESPONSE_DIR" ]; then
    echo "WARNING: No response folder found. Skipping $SERVICE_NAME"
    add_summary "| - | ⚠️ SKIP | - | No response folder |"
    continue
  fi

  FOUND_FILES=false
  for REQUEST_FILE in "$REQUEST_DIR"/*_request.json; do
    [ -f "$REQUEST_FILE" ] && FOUND_FILES=true && break
  done

  if [ "$FOUND_FILES" = false ]; then
    echo "WARNING: No request files found in $REQUEST_DIR"
    add_summary "| - | ⚠️ SKIP | - | No request files |"
    continue
  fi

  for REQUEST_FILE in "$REQUEST_DIR"/*_request.json; do

    [ -f "$REQUEST_FILE" ] || continue

    FILENAME=$(basename "$REQUEST_FILE")
    TEST_NAME="${FILENAME/_request.json/}"
    RESPONSE_FILE="${RESPONSE_DIR}/${TEST_NAME}_response.json"

    echo ""
    echo ">> Test: $TEST_NAME"

    if [ ! -f "$RESPONSE_FILE" ]; then
      echo "   ERROR: Missing response file: $RESPONSE_FILE"
      FAILED=$((FAILED + 1))
      FAILED_DETAILS="${FAILED_DETAILS}\n[FAIL] ${SERVICE_NAME}/${TEST_NAME}\n"
      FAILED_DETAILS="${FAILED_DETAILS}  Missing response file\n"
      add_summary "| $TEST_NAME | ❌ FAIL | - | Missing response file |"
      continue
    fi

    # Read request
    METHOD=$(jq -r '.method' "$REQUEST_FILE")
    ENDPOINT=$(jq -r '.endpoint' "$REQUEST_FILE")
    QUERY_PARAMS=$(jq -r '.query_params // empty' "$REQUEST_FILE")
    BODY=$(jq -r '.body // empty' "$REQUEST_FILE")
    TOKEN_TYPE=$(jq -r '.token_type // "contract"' "$REQUEST_FILE")

    if [ -z "$METHOD" ] || [ "$METHOD" = "null" ]; then
      echo "   ERROR: method missing in request file"
      FAILED=$((FAILED + 1))
      FAILED_DETAILS="${FAILED_DETAILS}\n[FAIL] ${SERVICE_NAME}/${TEST_NAME}\n"
      FAILED_DETAILS="${FAILED_DETAILS}  method missing in request file\n"
      add_summary "| $TEST_NAME | ❌ FAIL | - | method missing |"
      continue
    fi

    if [ -z "$ENDPOINT" ] || [ "$ENDPOINT" = "null" ]; then
      echo "   ERROR: endpoint missing in request file"
      FAILED=$((FAILED + 1))
      FAILED_DETAILS="${FAILED_DETAILS}\n[FAIL] ${SERVICE_NAME}/${TEST_NAME}\n"
      FAILED_DETAILS="${FAILED_DETAILS}  endpoint missing in request file\n"
      add_summary "| $TEST_NAME | ❌ FAIL | - | endpoint missing |"
      continue
    fi

    if [ "$TOKEN_TYPE" = "access" ]; then
      AUTH_TOKEN="$AUTH_TOKEN_ACCESS"
    else
      AUTH_TOKEN="$AUTH_TOKEN_CONTRACT"
    fi

    if [ -n "$QUERY_PARAMS" ]; then
      FULL_URL="${BASE_URL}${ENDPOINT}?${QUERY_PARAMS}"
    else
      FULL_URL="${BASE_URL}${ENDPOINT}"
    fi

    echo "   Method  : $METHOD"
    echo "   URL     : $FULL_URL"
    [ -n "$BODY" ] && echo "   Body    : $BODY"
    echo "   Token   : $TOKEN_TYPE"

    # Read expected response
    EXPECTED_STATUS=$(jq -r '.expectedStatus' "$RESPONSE_FILE")
    MODE=$(jq -r '.validation.mode' "$RESPONSE_FILE")
    FIELDS=$(jq -r '.validation.fields // []' "$RESPONSE_FILE")
    EXPECTED_BODY=$(jq -r '.expectedResponse' "$RESPONSE_FILE")

    if [ -z "$EXPECTED_STATUS" ] || [ "$EXPECTED_STATUS" = "null" ]; then
      echo "   ERROR: expectedStatus missing in response file"
      FAILED=$((FAILED + 1))
      FAILED_DETAILS="${FAILED_DETAILS}\n[FAIL] ${SERVICE_NAME}/${TEST_NAME}\n"
      FAILED_DETAILS="${FAILED_DETAILS}  expectedStatus missing\n"
      add_summary "| $TEST_NAME | ❌ FAIL | - | expectedStatus missing |"
      continue
    fi

    if [ -z "$MODE" ] || [ "$MODE" = "null" ]; then
      echo "   ERROR: validation.mode missing in response file"
      FAILED=$((FAILED + 1))
      FAILED_DETAILS="${FAILED_DETAILS}\n[FAIL] ${SERVICE_NAME}/${TEST_NAME}\n"
      FAILED_DETAILS="${FAILED_DETAILS}  validation.mode missing\n"
      add_summary "| $TEST_NAME | ❌ FAIL | - | validation.mode missing |"
      continue
    fi

    # Fire request
    START_TIME=$(date +%s%3N)

    if [ -n "$BODY" ]; then
      RESPONSE=$(curl -s \
        --max-time $CURL_TIMEOUT \
        -w "\n%{http_code}" \
        -X "$METHOD" \
        -H "accept: application/json" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        -d "$BODY" \
        "$FULL_URL")
    else
      RESPONSE=$(curl -s \
        --max-time $CURL_TIMEOUT \
        -w "\n%{http_code}" \
        -X "$METHOD" \
        -H "accept: application/json" \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        "$FULL_URL")
    fi

    END_TIME=$(date +%s%3N)
    RESPONSE_TIME=$((END_TIME - START_TIME))

    ACTUAL_STATUS=$(echo "$RESPONSE" | tail -1)
    ACTUAL_BODY=$(echo "$RESPONSE" | head -n -1)

    echo "   Status  : $ACTUAL_STATUS (expected: $EXPECTED_STATUS)"
    echo "   Time    : ${RESPONSE_TIME}ms"

    # Check status code
    if [ "$ACTUAL_STATUS" != "$EXPECTED_STATUS" ]; then
      echo "   RESULT  : FAIL ✗"
      FAILED=$((FAILED + 1))
      FAILED_DETAILS="${FAILED_DETAILS}\n[FAIL] ${SERVICE_NAME}/${TEST_NAME}\n"
      FAILED_DETAILS="${FAILED_DETAILS}  Status   : expected=$EXPECTED_STATUS actual=$ACTUAL_STATUS\n"
      FAILED_DETAILS="${FAILED_DETAILS}  Body     : $ACTUAL_BODY\n"
      add_summary "| $TEST_NAME | ❌ FAIL | ${RESPONSE_TIME}ms | Status: expected=$EXPECTED_STATUS actual=$ACTUAL_STATUS |"
      continue
    fi

    # Check valid JSON
    if ! echo "$ACTUAL_BODY" | jq . > /dev/null 2>&1; then
      echo "   RESULT  : FAIL ✗ — response is not valid JSON"
      FAILED=$((FAILED + 1))
      FAILED_DETAILS="${FAILED_DETAILS}\n[FAIL] ${SERVICE_NAME}/${TEST_NAME}\n"
      FAILED_DETAILS="${FAILED_DETAILS}  Response is not valid JSON\n"
      FAILED_DETAILS="${FAILED_DETAILS}  Raw: $ACTUAL_BODY\n"
      add_summary "| $TEST_NAME | ❌ FAIL | ${RESPONSE_TIME}ms | Response not valid JSON |"
      continue
    fi

    echo "   Mode    : $MODE"

    TEST_PASSED=true
    TEST_DIFF=""

    case "$MODE" in

      "EXACT")
        DIFF_OUTPUT=$(diff \
          <(echo "$EXPECTED_BODY" | jq -S .) \
          <(echo "$ACTUAL_BODY" | jq -S .) 2>&1)
        if [ -n "$DIFF_OUTPUT" ]; then
          TEST_PASSED=false
          TEST_DIFF="$DIFF_OUTPUT"
        fi
        ;;

      "CONTAINS")
        for KEY in $(echo "$EXPECTED_BODY" | jq -r 'keys[]'); do
          EXPECTED_VAL=$(echo "$EXPECTED_BODY" | \
            jq -r --arg k "$KEY" '.[$k] | tostring')
          ACTUAL_VAL=$(echo "$ACTUAL_BODY" | \
            jq -r --arg k "$KEY" '.[$k] // "MISSING" | tostring')
          if [ "$EXPECTED_VAL" != "$ACTUAL_VAL" ]; then
            TEST_PASSED=false
            TEST_DIFF="${TEST_DIFF}  Field    : $KEY\n"
            TEST_DIFF="${TEST_DIFF}  Expected : $EXPECTED_VAL\n"
            TEST_DIFF="${TEST_DIFF}  Actual   : $ACTUAL_VAL\n\n"
          fi
        done
        ;;

      "IGNORE")
        STRIPPED_ACTUAL="$ACTUAL_BODY"
        for FIELD in $(echo "$FIELDS" | jq -r '.[]'); do
          STRIPPED_ACTUAL=$(echo "$STRIPPED_ACTUAL" | jq "del(.$FIELD)")
          echo "   Ignoring: $FIELD"
        done
        DIFF_OUTPUT=$(diff \
          <(echo "$EXPECTED_BODY" | jq -S .) \
          <(echo "$STRIPPED_ACTUAL" | jq -S .) 2>&1)
        if [ -n "$DIFF_OUTPUT" ]; then
          TEST_PASSED=false
          TEST_DIFF="$DIFF_OUTPUT"
        fi
        ;;

      "EXISTS")
        for FIELD in $(echo "$FIELDS" | jq -r '.[]'); do
          EXISTS=$(echo "$ACTUAL_BODY" | \
            jq -r --arg f "$FIELD" 'has($f)')
          if [ "$EXISTS" = "true" ]; then
            echo "   EXISTS  : $FIELD ✓"
          else
            TEST_PASSED=false
            TEST_DIFF="${TEST_DIFF}  Field '$FIELD' not found in response\n"
          fi
        done
        ;;

      *)
        TEST_PASSED=false
        TEST_DIFF="Unknown validation mode: $MODE\nAllowed: EXACT, CONTAINS, IGNORE, EXISTS"
        ;;

    esac

    if [ "$TEST_PASSED" = true ]; then
      echo "   RESULT  : PASS ✓"
      PASSED=$((PASSED + 1))
      add_summary "| $TEST_NAME | ✅ PASS | ${RESPONSE_TIME}ms | - |"
    else
      echo "   RESULT  : FAIL ✗"
      FAILED=$((FAILED + 1))
      FAILED_DETAILS="${FAILED_DETAILS}\n[FAIL] ${SERVICE_NAME}/${TEST_NAME}\n${TEST_DIFF}\n"
      add_summary "| $TEST_NAME | ❌ FAIL | ${RESPONSE_TIME}ms | See details below |"
    fi

  done

  add_summary ""

done

# ── STEP 5: FINAL SUMMARY ─────────────────────────────────

TOTAL=$((PASSED + FAILED))

print_header "FAILED TEST DETAILS"

if [ $FAILED -gt 0 ]; then
  echo -e "$FAILED_DETAILS"
else
  echo "  No failures ✓"
fi

print_header "FINAL RESULTS"

echo ""
echo "  Total  : $TOTAL"
echo "  Passed : $PASSED ✓"
echo "  Failed : $FAILED ✗"
echo ""

if [ $FAILED -eq 0 ]; then
  echo "  ✓ ALL TESTS PASSED"
  EXIT_CODE=0
else
  echo "  ✗ $FAILED TEST(S) FAILED"
  EXIT_CODE=1
fi

echo ""

add_summary "## Final Results"
add_summary "| Total | Passed | Failed |"
add_summary "|-------|--------|--------|"
add_summary "| $TOTAL | $PASSED ✅ | $FAILED ❌ |"

if [ $FAILED -gt 0 ]; then
  add_summary ""
  add_summary "## Failed Test Details"
  add_summary "\`\`\`"
  echo -e "$FAILED_DETAILS" >> "$GITHUB_STEP_SUMMARY" 2>/dev/null || true
  add_summary "\`\`\`"
fi

exit $EXIT_CODE
```

---

## File 3 — `testApi/bos-contract-service/request/healthCheck_request.json`

```json
{
  "_comment": "Health check API for contract-service",
  "method": "GET",
  "endpoint": "/contract-service/api/v1/do-status-check",
  "query_params": "",
  "body": "",
  "token_type": "contract"
}
```

---

## File 4 — `testApi/bos-contract-service/response/healthCheck_response.json`

```json
{
  "_comment": "Expected response for health check. Exact match on message field.",
  "expectedStatus": 200,
  "validation": {
    "mode": "EXACT",
    "fields": []
  },
  "expectedResponse": {
    "message": "UP"
  }
}
```

---

## File 5 — `testApi/bos-contract-service/request/currencyApi_request.json`

```json
{
  "_comment": "Currency API for contract-service",
  "method": "GET",
  "endpoint": "/contract-service/api/v1/currencies",
  "query_params": "sortBy=ccyCode&sortingOrder=asc",
  "body": "",
  "token_type": "contract"
}
```

---

## File 6 — `testApi/bos-contract-service/response/currencyApi_response.json`

```json
{
  "_comment": "Expected response for currency API. Only checking totalElements exists not its value.",
  "expectedStatus": 200,
  "validation": {
    "mode": "EXISTS",
    "fields": ["totalElements"]
  },
  "expectedResponse": {}
}
```

---

## Git Steps

```bash
# Create folder structure
mkdir -p testApi/bos-contract-service/request
mkdir -p testApi/bos-contract-service/response

# Make shell script executable
chmod +x nrt-runner.sh

# Stage everything
git add .

# Commit
git commit -m "feat: add shell-based NRT engine v2"

# Push
git push origin nrt-v2
```

Then go to GitHub Actions → NRT - Non Regression Tests → Run workflow → select `nrt-v2` branch → select environment → paste both tokens → Run.

Share what you get.

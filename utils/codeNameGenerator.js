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



------------------------


    I can read all the code clearly. Now I have everything I need. Here are both complete updated files.

---

## File 1 — `nrt.yml`

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

      service:
        description: 'Select service to test'
        required: true
        type: choice
        options:
          - bos-contract-service
          - bos-access-management

      auth_token_service:
        description: 'Bearer token for selected service (copy from Swagger)'
        required: true
        type: string

      auth_token_access:
        description: 'Bearer token for access-management (not required if service = bos-access-management)'
        required: false
        type: string

jobs:
  nrt:
    runs-on: [self-hosted, linux]

    steps:

      - name: Checkout Code
        uses: actions/checkout@v4

      # RBAC Check using GitHub Secret NRT_ALLOWED_USERS
      # Ask repo admin to add secret: NRT_ALLOWED_USERS = "vivek-narayana,amisha-sinha"
      - name: RBAC Check
        run: |
          ALLOWED_USERS="${{ secrets.NRT_ALLOWED_USERS }}"

          if [[ -z "$ALLOWED_USERS" ]]; then
            echo "ERROR: NRT_ALLOWED_USERS secret is not set"
            echo "Ask repo admin to add secret: NRT_ALLOWED_USERS"
            exit 1
          fi

          IFS=',' read -ra USERS <<< "$ALLOWED_USERS"
          AUTHORIZED=false

          for USER in "${USERS[@]}"; do
            TRIMMED=$(echo "$USER" | tr -d '[:space:]')
            if [[ "${{ github.actor }}" == "$TRIMMED" ]]; then
              AUTHORIZED=true
              break
            fi
          done

          if [[ "$AUTHORIZED" == "false" ]]; then
            echo "ERROR: User '${{ github.actor }}' is not authorized to run NRT pipeline"
            exit 1
          fi

          echo ">> RBAC: User '${{ github.actor }}' is authorized ✓"

      - name: Set Base URL
        run: |
          if [ "${{ inputs.environment }}" = "dev" ]; then
            echo "BASE_URL=https://bo-services-dev.fr.world.socgen" >> $GITHUB_ENV
          else
            echo "BASE_URL=https://bo-services-uat.fr.world.socgen" >> $GITHUB_ENV
          fi

      - name: Run NRT
        env:
          AUTH_TOKEN_SERVICE: ${{ inputs.auth_token_service }}
          AUTH_TOKEN_ACCESS: ${{ inputs.auth_token_access }}
          SERVICE: ${{ inputs.service }}
          ENVIRONMENT: ${{ inputs.environment }}
        run: bash nrt-runner.sh
```

---

## File 2 — `nrt-runner.sh`

```bash
#!/bin/bash

# ═══════════════════════════════════════════════════════════
# NRT Runner — Non Regression Test Engine v2.1
# ═══════════════════════════════════════════════════════════
#
# WHAT IT DOES:
# 1. Validates token(s) against tokeninfo endpoint
# 2. Prints user metadata from access-management service
# 3. Runs tests for the selected service ONLY
# 4. Fires curl requests and compares responses
# 5. Prints numbered pass/fail summary with diffs
#
# VALIDATION MODES:
#   EXACT    → every field must match exactly
#   CONTAINS → expected fields must match, extras ignored
#   IGNORE   → strip listed fields, compare rest
#   EXISTS   → only check listed fields exist, values ignored
#
# HOW TO RUN LOCALLY:
#   export AUTH_TOKEN_SERVICE=your_service_token
#   export AUTH_TOKEN_ACCESS=your_access_token
#   export BASE_URL=https://bo-services-dev.fr.world.socgen
#   export SERVICE=bos-contract-service
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
FAILURE_COUNT=0   # for numbered failures

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

print_response_body() {
  local BODY=$1
  local LINE_COUNT
  LINE_COUNT=$(echo "$BODY" | wc -l)
  if [ "$LINE_COUNT" -gt 20 ]; then
    echo "   Response: (showing 20/$LINE_COUNT lines)"
    echo "$BODY" | head -n 20
    echo "   ... truncated"
  else
    echo "   Response: $BODY"
  fi
}

# ── STEP 1: VALIDATE INPUTS ───────────────────────────────

print_header "INPUT VALIDATION"

if [ -z "$SERVICE" ]; then
  echo "ERROR: SERVICE is not set"
  exit 1
fi

if [ -z "$AUTH_TOKEN_SERVICE" ]; then
  echo "ERROR: AUTH_TOKEN_SERVICE is not set"
  exit 1
fi

# Access management token is only required
# when service is NOT bos-access-management
if [ "$SERVICE" != "bos-access-management" ]; then
  if [ -z "$AUTH_TOKEN_ACCESS" ]; then
    echo "ERROR: AUTH_TOKEN_ACCESS is not set"
    echo "AUTH_TOKEN_ACCESS is required when testing $SERVICE"
    exit 1
  fi
fi

if [ -z "$BASE_URL" ]; then
  echo "ERROR: BASE_URL is not set"
  exit 1
fi

echo ">> Environment : ${ENVIRONMENT:-local}"
echo ">> Base URL    : $BASE_URL"
echo ">> Service     : $SERVICE"
echo ">> Inputs      : OK ✓"

# ── STEP 2: VALIDATE TOKENS ───────────────────────────────

print_header "TOKEN VALIDATION"

# ── Validate service token ────────────────────────────────
echo ""
echo ">> Validating $SERVICE token..."

SERVICE_INFO=$(curl -s \
  --max-time $CURL_TIMEOUT \
  "${TOKENINFO_URL}?access_token=${AUTH_TOKEN_SERVICE}")
CURL_EXIT=$?

if [ $CURL_EXIT -ne 0 ]; then
  if [ $CURL_EXIT -eq 28 ]; then
    echo "ERROR: tokeninfo request timed out for $SERVICE token"
  else
    echo "ERROR: Could not reach tokeninfo endpoint for $SERVICE token"
    echo "curl exit code: $CURL_EXIT"
  fi
  exit 1
fi

if [ -z "$SERVICE_INFO" ]; then
  echo "ERROR: tokeninfo returned empty response for $SERVICE token"
  exit 1
fi

if ! echo "$SERVICE_INFO" | jq . > /dev/null 2>&1; then
  echo "ERROR: tokeninfo returned invalid JSON for $SERVICE token"
  echo "Raw: $SERVICE_INFO"
  exit 1
fi

SERVICE_ERROR=$(echo "$SERVICE_INFO" | jq -r '.error // empty')
if [ -n "$SERVICE_ERROR" ]; then
  echo "ERROR: $SERVICE token is invalid or expired"
  echo "Details: $(echo "$SERVICE_INFO" | \
    jq -r '.error_description // .error')"
  exit 1
fi

USER_EMAIL=$(echo "$SERVICE_INFO" | \
  jq -r '.subname // .sub // .email // empty')

if [ -z "$USER_EMAIL" ]; then
  echo "ERROR: Could not extract user email from $SERVICE token"
  exit 1
fi

SERVICE_EXPIRES=$(echo "$SERVICE_INFO" | \
  jq -r '.expires_in // "unknown"')

echo ">> $SERVICE token : VALID ✓"
echo ">> Expires in      : ${SERVICE_EXPIRES}s"
echo ">> User Email      : $USER_EMAIL"

# ── Validate access-management token ─────────────────────
# Only needed when service != bos-access-management
if [ "$SERVICE" != "bos-access-management" ]; then

  echo ""
  echo ">> Validating access-management token..."

  ACCESS_INFO=$(curl -s \
    --max-time $CURL_TIMEOUT \
    "${TOKENINFO_URL}?access_token=${AUTH_TOKEN_ACCESS}")
  CURL_EXIT=$?

  if [ $CURL_EXIT -ne 0 ]; then
    if [ $CURL_EXIT -eq 28 ]; then
      echo "ERROR: tokeninfo request timed out for access-management token"
    else
      echo "ERROR: Could not reach tokeninfo endpoint for access-management token"
      echo "curl exit code: $CURL_EXIT"
    fi
    exit 1
  fi

  if [ -z "$ACCESS_INFO" ]; then
    echo "ERROR: tokeninfo returned empty response for access-management token"
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

fi

# ── STEP 3: PRINT USER METADATA ───────────────────────────

print_header "USER METADATA"

ENCODED_EMAIL=$(echo "$USER_EMAIL" | sed 's/@/%40/g')

# If running access-management service use service token
# Otherwise use access token for metadata call
if [ "$SERVICE" = "bos-access-management" ]; then
  METADATA_TOKEN="$AUTH_TOKEN_SERVICE"
else
  METADATA_TOKEN="$AUTH_TOKEN_ACCESS"
fi

USER_INFO=$(curl -s \
  --max-time $CURL_TIMEOUT \
  -H "accept: application/json" \
  -H "Authorization: Bearer $METADATA_TOKEN" \
  "${BASE_URL}/access-management-service/api/v1/users/${ENCODED_EMAIL}")
CURL_EXIT=$?

if [ $CURL_EXIT -ne 0 ]; then
  echo "WARNING: Could not reach access-management service (exit: $CURL_EXIT). Continuing..."
elif [ -z "$USER_INFO" ]; then
  echo "WARNING: Empty response from access-management. Continuing..."
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
  exit 1
fi

# Run ONLY the selected service folder
SERVICE_DIR="testApi/${SERVICE}/"

if [ ! -d "$SERVICE_DIR" ]; then
  echo "ERROR: Service folder not found: $SERVICE_DIR"
  echo "Create testApi/${SERVICE}/request/ and response/ folders."
  exit 1
fi

REQUEST_DIR="${SERVICE_DIR}request"
RESPONSE_DIR="${SERVICE_DIR}response"

add_summary "# NRT Test Results"
add_summary "**Environment:** ${ENVIRONMENT:-local} | **Base URL:** $BASE_URL | **Service:** $SERVICE | **User:** $USER_EMAIL"
add_summary ""

echo ""
print_divider
echo "  Service: $SERVICE"
print_divider

add_summary "## $SERVICE"
add_summary "| Test | Status | Time | Details |"
add_summary "|------|--------|------|---------|"

if [ ! -d "$REQUEST_DIR" ]; then
  echo "ERROR: No request folder found at $REQUEST_DIR"
  add_summary "| - | ❌ ERROR | - | No request folder |"
  exit 1
fi

if [ ! -d "$RESPONSE_DIR" ]; then
  echo "ERROR: No response folder found at $RESPONSE_DIR"
  add_summary "| - | ❌ ERROR | - | No response folder |"
  exit 1
fi

FOUND_FILES=false
for REQUEST_FILE in "$REQUEST_DIR"/*_request.json; do
  [ -f "$REQUEST_FILE" ] && FOUND_FILES=true && break
done

if [ "$FOUND_FILES" = false ]; then
  echo "ERROR: No request files found in $REQUEST_DIR"
  add_summary "| - | ❌ ERROR | - | No request files |"
  exit 1
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
    FAILURE_COUNT=$((FAILURE_COUNT + 1))
    FAILED_DETAILS="${FAILED_DETAILS}\n${FAILURE_COUNT}. [FAIL] ${SERVICE}/${TEST_NAME}\n"
    FAILED_DETAILS="${FAILED_DETAILS}   Missing response file\n"
    add_summary "| $TEST_NAME | ❌ FAIL | - | Missing response file |"
    continue
  fi

  # Read request details
  METHOD=$(jq -r '.method' "$REQUEST_FILE")
  ENDPOINT=$(jq -r '.endpoint' "$REQUEST_FILE")
  QUERY_PARAMS=$(jq -r '.query_params // empty' "$REQUEST_FILE")
  BODY=$(jq -r '.body // empty' "$REQUEST_FILE")

  if [ -z "$METHOD" ] || [ "$METHOD" = "null" ]; then
    echo "   ERROR: method missing in request file"
    FAILED=$((FAILED + 1))
    FAILURE_COUNT=$((FAILURE_COUNT + 1))
    FAILED_DETAILS="${FAILED_DETAILS}\n${FAILURE_COUNT}. [FAIL] ${SERVICE}/${TEST_NAME}\n"
    FAILED_DETAILS="${FAILED_DETAILS}   method missing in request file\n"
    add_summary "| $TEST_NAME | ❌ FAIL | - | method missing |"
    continue
  fi

  if [ -z "$ENDPOINT" ] || [ "$ENDPOINT" = "null" ]; then
    echo "   ERROR: endpoint missing in request file"
    FAILED=$((FAILED + 1))
    FAILURE_COUNT=$((FAILURE_COUNT + 1))
    FAILED_DETAILS="${FAILED_DETAILS}\n${FAILURE_COUNT}. [FAIL] ${SERVICE}/${TEST_NAME}\n"
    FAILED_DETAILS="${FAILED_DETAILS}   endpoint missing in request file\n"
    add_summary "| $TEST_NAME | ❌ FAIL | - | endpoint missing |"
    continue
  fi

  # Always use service token for API calls
  AUTH_TOKEN="$AUTH_TOKEN_SERVICE"

  if [ -n "$QUERY_PARAMS" ]; then
    FULL_URL="${BASE_URL}${ENDPOINT}?${QUERY_PARAMS}"
  else
    FULL_URL="${BASE_URL}${ENDPOINT}"
  fi

  echo "   Method  : $METHOD"
  echo "   URL     : $FULL_URL"
  [ -n "$BODY" ] && echo "   Body    : $BODY"

  # Read expected response
  EXPECTED_STATUS=$(jq -r '.expectedStatus' "$RESPONSE_FILE")
  MODE=$(jq -r '.validation.mode' "$RESPONSE_FILE")
  FIELDS=$(jq -r '.validation.fields // []' "$RESPONSE_FILE")
  EXPECTED_BODY=$(jq -r '.expectedResponse' "$RESPONSE_FILE")

  if [ -z "$EXPECTED_STATUS" ] || [ "$EXPECTED_STATUS" = "null" ]; then
    echo "   ERROR: expectedStatus missing in response file"
    FAILED=$((FAILED + 1))
    FAILURE_COUNT=$((FAILURE_COUNT + 1))
    FAILED_DETAILS="${FAILED_DETAILS}\n${FAILURE_COUNT}. [FAIL] ${SERVICE}/${TEST_NAME}\n"
    FAILED_DETAILS="${FAILED_DETAILS}   expectedStatus missing\n"
    add_summary "| $TEST_NAME | ❌ FAIL | - | expectedStatus missing |"
    continue
  fi

  if [ -z "$MODE" ] || [ "$MODE" = "null" ]; then
    echo "   ERROR: validation.mode missing in response file"
    FAILED=$((FAILED + 1))
    FAILURE_COUNT=$((FAILURE_COUNT + 1))
    FAILED_DETAILS="${FAILED_DETAILS}\n${FAILURE_COUNT}. [FAIL] ${SERVICE}/${TEST_NAME}\n"
    FAILED_DETAILS="${FAILED_DETAILS}   validation.mode missing\n"
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
  CURL_EXIT=$?

  END_TIME=$(date +%s%3N)
  RESPONSE_TIME=$((END_TIME - START_TIME))

  # Curl failure handling
  if [ $CURL_EXIT -ne 0 ]; then
    if [ $CURL_EXIT -eq 28 ]; then
      CURL_ERROR="Request timed out after ${CURL_TIMEOUT}s"
    else
      CURL_ERROR="Network error or server unreachable (curl exit: $CURL_EXIT)"
    fi
    echo "   ERROR   : $CURL_ERROR"
    echo "   RESULT  : FAIL ✗"
    FAILED=$((FAILED + 1))
    FAILURE_COUNT=$((FAILURE_COUNT + 1))
    FAILED_DETAILS="${FAILED_DETAILS}\n${FAILURE_COUNT}. [FAIL] ${SERVICE}/${TEST_NAME}\n"
    FAILED_DETAILS="${FAILED_DETAILS}   $CURL_ERROR\n"
    add_summary "| $TEST_NAME | ❌ FAIL | ${RESPONSE_TIME}ms | $CURL_ERROR |"
    continue
  fi

  # Split status and body
  ACTUAL_STATUS=$(echo "$RESPONSE" | tail -1)
  ACTUAL_BODY=$(echo "$RESPONSE" | head -n -1)

  echo "   Status  : $ACTUAL_STATUS (expected: $EXPECTED_STATUS)"
  echo "   Time    : ${RESPONSE_TIME}ms"

  # Print truncated response body
  print_response_body "$ACTUAL_BODY"

  # Check status code
  if [ "$ACTUAL_STATUS" != "$EXPECTED_STATUS" ]; then
    echo "   RESULT  : FAIL ✗"
    FAILED=$((FAILED + 1))
    FAILURE_COUNT=$((FAILURE_COUNT + 1))
    FAILED_DETAILS="${FAILED_DETAILS}\n${FAILURE_COUNT}. [FAIL] ${SERVICE}/${TEST_NAME}\n"
    FAILED_DETAILS="${FAILED_DETAILS}   Status : expected=$EXPECTED_STATUS actual=$ACTUAL_STATUS\n"
    add_summary "| $TEST_NAME | ❌ FAIL | ${RESPONSE_TIME}ms | Status: expected=$EXPECTED_STATUS actual=$ACTUAL_STATUS |"
    continue
  fi

  # Check valid JSON
  if ! echo "$ACTUAL_BODY" | jq . > /dev/null 2>&1; then
    echo "   RESULT  : FAIL ✗ — response is not valid JSON"
    FAILED=$((FAILED + 1))
    FAILURE_COUNT=$((FAILURE_COUNT + 1))
    FAILED_DETAILS="${FAILED_DETAILS}\n${FAILURE_COUNT}. [FAIL] ${SERVICE}/${TEST_NAME}\n"
    FAILED_DETAILS="${FAILED_DETAILS}   Response is not valid JSON\n"
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
          TEST_DIFF="${TEST_DIFF}   Field    : $KEY\n"
          TEST_DIFF="${TEST_DIFF}   Expected : $EXPECTED_VAL\n"
          TEST_DIFF="${TEST_DIFF}   Actual   : $ACTUAL_VAL\n\n"
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
          TEST_DIFF="${TEST_DIFF}   Field '$FIELD' not found in response\n"
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
    FAILURE_COUNT=$((FAILURE_COUNT + 1))
    FAILED_DETAILS="${FAILED_DETAILS}\n${FAILURE_COUNT}. [FAIL] ${SERVICE}/${TEST_NAME}\n${TEST_DIFF}\n"
    add_summary "| $TEST_NAME | ❌ FAIL | ${RESPONSE_TIME}ms | See details below |"
  fi

done

add_summary ""

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

## What Changed From Previous Version

```
nrt.yml:
  + service dropdown (bos-contract-service, bos-access-management)
  + auth_token_contract → auth_token_service (generic)
  + auth_token_access → required: false
  + RBAC step using secrets.NRT_ALLOWED_USERS
  + SERVICE passed as env var to script

nrt-runner.sh:
  + SERVICE variable handling throughout
  + Token validation skips access token
    when service = bos-access-management
  + User metadata uses correct token
    based on selected service
  + Only selected service folder runs
    (no more loop over all folders)
  + Always uses AUTH_TOKEN_SERVICE for API calls
  + FAILURE_COUNT for numbered failures
  + AUTH_TOKEN_CONTRACT → AUTH_TOKEN_SERVICE throughout
```

---

## One Thing You Need To Do First

Ask repo admin to add this GitHub Secret:

```
Name  : NRT_ALLOWED_USERS
Value : vivek-narayana,amisha-sinha
```

Without this the RBAC check will fail for everyone.

---

## Git Steps

```bash
git add .
git commit -m "feat: add service dropdown, RBAC, single service execution"
git push origin nrt-v2
```

Then trigger and share what you get.

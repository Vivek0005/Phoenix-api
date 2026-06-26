#!/usr/bin/env bash
# =============================================================================
# BOS-NRT Engine  (nrt-v3 — single-file test-suite format)
# -----------------------------------------------------------------------------
# Data-driven Non Regression Testing for Back Office Services APIs.
#
# One JSON file per API under  testApi/<service>/<apiName>.json
# Each file carries API-level fields (method, api_endpoint) + a test_suite[]
# of scenarios. Four validation modes (EXACT / CONTAINS / IGNORE / EXISTS) now
# understand nested objects and arrays.
#
# Env in:  ENVIRONMENT  SERVICE  BASE_URL  AUTH_TOKEN_SERVICE  AUTH_TOKEN_ACCESS
# Exit  :  0 = all passed, 1 = any failure / fatal setup error
# =============================================================================

set -o pipefail

# ------------------------------------------------------------------ CONSTANTS
case "$ENVIRONMENT" in
  dev|local|uat)
    # Lower environments use the SG Connect homologation IdP.
    # TODO(infra): confirm uat uses the same tokeninfo host as dev.
    TOKENINFO_URL="https://sgconnect-hom.fr.world.socgen/sgconnect/oauth2/tokeninfo"
    ;;
  hom)
    TOKENINFO_URL="https://sso.sgmarkets.com/sgconnect/oauth2/tokeninfo"
    ;;
  *)
    echo "ERROR: Unknown ENVIRONMENT=$ENVIRONMENT (expected dev|local|uat|hom)"
    exit 1
    ;;
esac

CURL_TIMEOUT=50
PASSED=0
FAILED=0
FAILED_DETAILS=""
FAILURE_COUNT=0

# Strict structural containment used by CONTAINS (no substring matching).
read -r -d '' CONTAINS_DEF <<'JQ'
def contains_strict($a; $b):
  ($b | type) as $bt |
  if $bt == "object" then
    ($a | type) == "object" and
    ([ $b | to_entries[] | . as $e |
        ($a | has($e.key)) and contains_strict($a[$e.key]; $e.value)
     ] | all)
  elif $bt == "array" then
    ($a | type) == "array" and
    ([ $b[] as $bv | ([ $a[] as $av | contains_strict($av; $bv) ] | any) ] | all)
  else
    $a == $b
  end;
JQ

# -------------------------------------------------------------------- HELPERS
add_summary() {
  [ -n "$GITHUB_STEP_SUMMARY" ] && echo "$1" >> "$GITHUB_STEP_SUMMARY"
}

print_header() {
  echo ""
  echo "======================================="
  echo "  $1"
  echo "======================================="
}

print_divider() { echo "---------------------------------------"; }

print_response_body() {
  local BODY=$1 FORMATTED LINE_COUNT
  if echo "$BODY" | jq . > /dev/null 2>&1; then
    FORMATTED=$(echo "$BODY" | jq .)
  else
    FORMATTED="$BODY"
  fi
  LINE_COUNT=$(echo "$FORMATTED" | wc -l)
  if [ "$LINE_COUNT" -gt 20 ]; then
    echo "    Response: (showing 20/$LINE_COUNT lines)"
    echo "$FORMATTED" | head -n 20
    echo "    ... truncated"
  else
    echo "    Response: $FORMATTED"
  fi
}

# Normalise a field token into a jq path expression: "id" -> ".id"
normalize_path() {
  local p="$1"
  p="${p#"${p%%[![:space:]]*}"}"
  p="${p%"${p##*[![:space:]]}"}"
  [[ "$p" == .* ]] && printf '%s' "$p" || printf '%s' ".$p"
}

# Append a numbered failure to the running report and bump counters.
record_fail() {           # $1 = label, $2 = detail block (multiline ok)
  FAILED=$((FAILED + 1))
  FAILURE_COUNT=$((FAILURE_COUNT + 1))
  FAILED_DETAILS+="${FAILURE_COUNT}. [FAIL] ${1}"$'\n'
  if [ -n "$2" ]; then
    while IFS= read -r __line; do
      FAILED_DETAILS+="    ${__line}"$'\n'
    done <<< "$2"
  fi
  FAILED_DETAILS+=$'\n'
}

# ----------------------------------------------------------- VALIDATION MODES
# Each sets global VALIDATION_DIFF and returns 0 (pass) / 1 (fail).

validate_exact() {        # $1 actual  $2 expected
  local d
  d=$(diff <(jq -S . <<<"$2") <(jq -S . <<<"$1") 2>&1)
  [ -z "$d" ] && return 0
  VALIDATION_DIFF+="$d"$'\n'
  return 1
}

validate_contains() {     # $1 actual  $2 expected (subset)
  local res
  [ "$(jq -c . <<<"$2" 2>/dev/null)" = "{}" ] && return 0   # status-only idiom
  res=$(jq -n --argjson a "$1" --argjson b "$2" \
        "$CONTAINS_DEF"' [ $a | .. | contains_strict(.; $b) ] | any' 2>/dev/null)
  [ "$res" = "true" ] && return 0
  VALIDATION_DIFF+="Expected subset not found in any object of the response:"$'\n'
  VALIDATION_DIFF+="$(jq -c . <<<"$2")"$'\n'
  return 1
}

validate_ignore() {       # $1 actual  $2 expected  $3 excluded_fields (json array)
  local pipe="." f norm sa se d
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    norm=$(normalize_path "$f")
    pipe="$pipe | del($norm)"
  done < <(jq -r '.[]?' <<<"$3" 2>/dev/null)

  if ! sa=$(jq "$pipe" <<<"$1" 2>/dev/null); then
    VALIDATION_DIFF+="Invalid excluded_fields path while stripping actual response"$'\n'
    return 1
  fi
  se=$(jq "$pipe" <<<"$2" 2>/dev/null)
  d=$(diff <(jq -S . <<<"$se") <(jq -S . <<<"$sa") 2>&1)
  [ -z "$d" ] && return 0
  VALIDATION_DIFF+="After ignoring fields, remaining response differs:"$'\n'
  VALIDATION_DIFF+="$d"$'\n'
  return 1
}

# Non-empty = not null, "", [], {}.  Concrete 0 / false PASS.
validate_exists() {       # $1 actual  $2 fields (json array)
  local ok=0 raw p collected len allne
  while IFS= read -r raw; do
    [ -z "$raw" ] && continue
    p=$(normalize_path "$raw")
    if ! collected=$(jq -c "[ $p ]" <<<"$1" 2>/dev/null); then
      VALIDATION_DIFF+="Field '$raw': invalid path or not traversable"$'\n'; ok=1; continue
    fi
    len=$(jq 'length' <<<"$collected" 2>/dev/null)
    if [ "${len:-0}" -eq 0 ]; then
      VALIDATION_DIFF+="Field '$raw': not present in response"$'\n'; ok=1; continue
    fi
    allne=$(jq 'all(.[]; . != null and . != "" and . != [] and . != {})' <<<"$collected" 2>/dev/null)
    if [ "$allne" != "true" ]; then
      VALIDATION_DIFF+="Field '$raw': present but empty/null in at least one match"$'\n'; ok=1; continue
    fi
  done < <(jq -r '.[]?' <<<"$2" 2>/dev/null)
  return $ok
}

# ===========================================================================
# STEP 1: VALIDATE INPUTS
# ===========================================================================
print_header "INPUT VALIDATION"

[ -z "$SERVICE" ]            && { echo "ERROR: SERVICE is not set"; exit 1; }
[ -z "$AUTH_TOKEN_SERVICE" ] && { echo "ERROR: AUTH_TOKEN_SERVICE is not set"; exit 1; }
[ -z "$BASE_URL" ]          && { echo "ERROR: BASE_URL is not set"; exit 1; }

if [ "$SERVICE" != "bos-access-management-service" ] && [ -z "$AUTH_TOKEN_ACCESS" ]; then
  echo "ERROR: AUTH_TOKEN_ACCESS is required when testing $SERVICE"
  exit 1
fi

echo ">> Environment : ${ENVIRONMENT:-local}"
echo ">> Base URL    : $BASE_URL"
echo ">> Service     : $SERVICE"
echo ">> Inputs      : OK"

# ===========================================================================
# STEP 2: VALIDATE TOKENS
# ===========================================================================
print_header "TOKEN VALIDATION"

echo ""
echo ">> Validating $SERVICE token..."
SERVICE_INFO=$(curl -s --max-time $CURL_TIMEOUT "${TOKENINFO_URL}?access_token=${AUTH_TOKEN_SERVICE}")
CURL_EXIT=$?
if [ $CURL_EXIT -ne 0 ]; then
  [ $CURL_EXIT -eq 28 ] && echo "ERROR: tokeninfo request timed out for $SERVICE token" \
                        || echo "ERROR: Could not reach tokeninfo endpoint for $SERVICE token (curl exit: $CURL_EXIT)"
  exit 1
fi
[ -z "$SERVICE_INFO" ] && { echo "ERROR: tokeninfo returned empty response for $SERVICE token"; exit 1; }
if ! echo "$SERVICE_INFO" | jq . > /dev/null 2>&1; then
  echo "ERROR: tokeninfo returned invalid JSON for $SERVICE token"; echo "Raw: $SERVICE_INFO"; exit 1
fi
SERVICE_ERROR=$(echo "$SERVICE_INFO" | jq -r '.error // empty')
if [ -n "$SERVICE_ERROR" ]; then
  echo "ERROR: $SERVICE token is invalid or expired"
  echo "Details: $(echo "$SERVICE_INFO" | jq -r '.error_description // .error')"
  exit 1
fi
USER_EMAIL=$(echo "$SERVICE_INFO" | jq -r '.subname // .sub // .email // empty')
[ -z "$USER_EMAIL" ] && { echo "ERROR: Could not extract user email from $SERVICE token"; exit 1; }
SERVICE_EXPIRES=$(echo "$SERVICE_INFO" | jq -r '.expires_in // "unknown"')
echo ">> $SERVICE token : VALID"
echo ">> Expires in     : ${SERVICE_EXPIRES}s"
echo ">> User           : $USER_EMAIL"
echo ">> BOP Scopes:"
echo "$SERVICE_INFO" | jq -r '.scope[]?' 2>/dev/null | while read -r scope; do
  [[ "$scope" == *"back-office-services"* ]] && echo "   - $scope"
done

if [ "$SERVICE" != "bos-access-management-service" ]; then
  echo ""
  echo ">> Validating bos-access-management-service token..."
  ACCESS_INFO=$(curl -s --max-time $CURL_TIMEOUT "${TOKENINFO_URL}?access_token=${AUTH_TOKEN_ACCESS}")
  CURL_EXIT=$?
  if [ $CURL_EXIT -ne 0 ]; then
    [ $CURL_EXIT -eq 28 ] && echo "ERROR: tokeninfo request timed out for access-management token" \
                          || echo "ERROR: Could not reach tokeninfo endpoint for access-management token (curl exit: $CURL_EXIT)"
    exit 1
  fi
  [ -z "$ACCESS_INFO" ] && { echo "ERROR: tokeninfo returned empty response for access-management token"; exit 1; }
  if ! echo "$ACCESS_INFO" | jq . > /dev/null 2>&1; then
    echo "ERROR: tokeninfo returned invalid JSON for access-management token"; echo "Raw: $ACCESS_INFO"; exit 1
  fi
  ACCESS_ERROR=$(echo "$ACCESS_INFO" | jq -r '.error // empty')
  if [ -n "$ACCESS_ERROR" ]; then
    echo "ERROR: access-management token is invalid or expired"
    echo "Details: $(echo "$ACCESS_INFO" | jq -r '.error_description // .error')"
    exit 1
  fi
  ACCESS_EXPIRES=$(echo "$ACCESS_INFO" | jq -r '.expires_in // "unknown"')
  echo ">> access-management token: VALID"
  echo ">> Expires in              : ${ACCESS_EXPIRES}s"
  echo ">> User                    : $(echo "$ACCESS_INFO" | jq -r '.subname // .sub // .email // empty')"
fi

# ===========================================================================
# STEP 3: USER METADATA  (non-blocking)
# ===========================================================================
print_header "USER METADATA"

ENCODED_EMAIL=$(echo "$USER_EMAIL" | sed 's/@/%40/g')
if [ "$SERVICE" = "bos-access-management-service" ]; then
  METADATA_TOKEN="$AUTH_TOKEN_SERVICE"
else
  METADATA_TOKEN="$AUTH_TOKEN_ACCESS"
fi

USER_INFO=$(curl -s --max-time $CURL_TIMEOUT \
  -H "accept: application/json" \
  -H "Authorization: Bearer $METADATA_TOKEN" \
  "${BASE_URL}/access-management-service/api/v1/users/${ENCODED_EMAIL}")
CURL_EXIT=$?

GIVEN_NAME="N/A"; SURNAME="N/A"
if [ $CURL_EXIT -ne 0 ]; then
  echo "WARNING: Could not reach access-management service (exit: $CURL_EXIT). Continuing..."
elif [ -z "$USER_INFO" ]; then
  echo "WARNING: Empty response from access-management. Continuing..."
elif ! echo "$USER_INFO" | jq . > /dev/null 2>&1; then
  echo "WARNING: User metadata response is not valid JSON. Continuing..."
else
  USER_ERROR=$(echo "$USER_INFO" | jq -r '.error // empty')
  if [ -n "$USER_ERROR" ]; then
    echo "WARNING: Could not fetch user metadata: $USER_ERROR. Continuing..."
  else
    GIVEN_NAME=$(echo "$USER_INFO" | jq -r '.givenName // "N/A"')
    SURNAME=$(echo "$USER_INFO" | jq -r '.surname // "N/A"')
    echo ""
    echo ">> Name  : $GIVEN_NAME $SURNAME"
    echo ">> Roles:"
    echo "$USER_INFO" | jq -r '.roles[]? // empty' | while read -r role; do echo "   - $role"; done
  fi
fi

# ===========================================================================
# STEP 4: RUN NRT TESTS  (selected service only)
# ===========================================================================
TOTAL_START_TIME=$(date +%s%3N)
print_header "NRT TEST EXECUTION"

[ ! -d "testApi" ] && { echo "ERROR: testApi folder not found."; exit 1; }
SERVICE_DIR="testApi/${SERVICE}/"
[ ! -d "$SERVICE_DIR" ] && { echo "ERROR: Service folder not found: $SERVICE_DIR"; exit 1; }

# ---- report header ----
add_summary "# NRT Report"
add_summary "**Environment:** ${ENVIRONMENT:-local}"
add_summary "**Base URL:** $BASE_URL"
add_summary ""
add_summary "## User / Token Metadata"
USER_NAME="$GIVEN_NAME $SURNAME"
[ "$USER_NAME" = "N/A N/A" ] && USER_NAME="$USER_EMAIL"
add_summary "**User:** $USER_NAME"
add_summary ""
add_summary "**BOP Scopes:**"
SCOPES=$(echo "$SERVICE_INFO" | jq -r '.scope[]?' 2>/dev/null | grep "back-office-services")
if [ -z "$SCOPES" ]; then add_summary "N/A"; else
  echo "$SCOPES" | while read -r scope; do add_summary "- $scope"; done
fi
add_summary ""
add_summary "**BOP Roles:**"
ROLES_LIST=$(echo "$USER_INFO" | jq -r '.roles[]?' 2>/dev/null)
if [ -z "$ROLES_LIST" ]; then add_summary "N/A"; else
  echo "$ROLES_LIST" | while read -r role; do add_summary "- $role"; done
fi
add_summary ""
add_summary "## Test Results"
add_summary "### Service: $SERVICE"
add_summary ""
add_summary "| Test | Description | Mode | Status |"
add_summary "|------|-------------|------|--------|"

echo ""
print_divider
echo "   Service: $SERVICE"
print_divider

# ---- discover API test files (top-level *.json only -> skips expected/) ----
FOUND_FILES=false
for TEST_FILE in "$SERVICE_DIR"*.json; do
  [ -f "$TEST_FILE" ] && FOUND_FILES=true && break
done
if [ "$FOUND_FILES" = false ]; then
  echo "ERROR: No API test files (*.json) found in $SERVICE_DIR"
  add_summary "| - | No test files found | - | ERROR |"
  exit 1
fi

for TEST_FILE in "$SERVICE_DIR"*.json; do
  [ -f "$TEST_FILE" ] || continue
  API_NAME=$(basename "$TEST_FILE" .json)

  echo ""
  echo "==> API file: $API_NAME"

  # ---- file-level validation ----
  if ! jq empty "$TEST_FILE" 2>/dev/null; then
    echo "    ERROR: $API_NAME.json is not valid JSON"
    record_fail "$API_NAME (file)" "File is not valid JSON"
    add_summary "| $API_NAME | Invalid JSON file | - | ERROR |"
    continue
  fi

  METHOD=$(jq -r '.method // empty' "$TEST_FILE")
  API_ENDPOINT=$(jq -r '.api_endpoint // empty' "$TEST_FILE")
  SUITE_LEN=$(jq '.test_suite | length' "$TEST_FILE" 2>/dev/null)

  if [ -z "$METHOD" ]; then
    record_fail "$API_NAME (file)" "method missing at API level"
    add_summary "| $API_NAME | method missing | - | ERROR |"; continue
  fi
  if [ -z "$API_ENDPOINT" ]; then
    record_fail "$API_NAME (file)" "api_endpoint missing at API level"
    add_summary "| $API_NAME | api_endpoint missing | - | ERROR |"; continue
  fi
  if [ -z "$SUITE_LEN" ] || [ "$SUITE_LEN" = "null" ] || [ "$SUITE_LEN" -eq 0 ]; then
    record_fail "$API_NAME (file)" "test_suite missing or empty"
    add_summary "| $API_NAME | test_suite missing/empty | - | ERROR |"; continue
  fi

  echo "    Method   : $METHOD"
  echo "    Endpoint : $API_ENDPOINT"
  echo "    Scenarios: $SUITE_LEN"

  SEEN_NAMES=" "

  # ---- loop scenarios by index (no subshell -> counters persist) ----
  for ((i = 0; i < SUITE_LEN; i++)); do
    SCEN=$(jq -c ".test_suite[$i]" "$TEST_FILE")

    TEST_NAME=$(jq -r '.test_name // empty' <<<"$SCEN")
    SDESC=$(jq -r '.description // ""' <<<"$SCEN")
    REQ_PARAMS=$(jq -r '.request_params // ""' <<<"$SCEN")
    REQ_PAYLOAD=$(jq -r '.request_payload // ""' <<<"$SCEN")
    EXP_STATUS=$(jq -r '.expected_status // empty' <<<"$SCEN")
    EXP_FILE=$(jq -r '.expected_response_file // ""' <<<"$SCEN")
    EXP_INLINE=$(jq -c '.expected_response // {}' <<<"$SCEN")
    MODE=$(jq -r '.validation_config.mode // empty' <<<"$SCEN")
    FIELDS=$(jq -c '.validation_config.fields // []' <<<"$SCEN")
    EXCLUDED=$(jq -c '.validation_config.excluded_fields // []' <<<"$SCEN")

    if [ -z "$TEST_NAME" ]; then TEST_NAME="scenario_$i"; fi
    LABEL="${API_NAME}.${TEST_NAME}"

    echo ""
    echo ">> Test: $LABEL"
    [ -n "$SDESC" ] && echo "    Description : $SDESC"

    # ---- scenario-level schema checks ----
    if [[ "$SEEN_NAMES" == *" $TEST_NAME "* ]]; then
      echo "    ERROR: duplicate test_name '$TEST_NAME'"
      record_fail "$LABEL" "Duplicate test_name within $API_NAME.json"
      add_summary "| $LABEL | $SDESC | - | ERROR |"; continue
    fi
    SEEN_NAMES="${SEEN_NAMES}${TEST_NAME} "

    if [ -z "$EXP_STATUS" ]; then
      record_fail "$LABEL" "expected_status missing"
      add_summary "| $LABEL | $SDESC | - | ERROR |"; continue
    fi
    if [ -z "$MODE" ]; then
      record_fail "$LABEL" "validation_config.mode missing"
      add_summary "| $LABEL | $SDESC | - | ERROR |"; continue
    fi
    case "$MODE" in EXACT|CONTAINS|IGNORE|EXISTS) ;; *)
      record_fail "$LABEL" "Unknown validation mode: $MODE (allowed: EXACT, CONTAINS, IGNORE, EXISTS)"
      add_summary "| $LABEL | $SDESC | $MODE | ERROR |"; continue ;;
    esac
    if [[ "$REQ_PARAMS" == *"&amp;"* ]]; then
      record_fail "$LABEL" "request_params contains HTML-encoded '&amp;' — use a literal '&'"
      add_summary "| $LABEL | $SDESC | $MODE | ERROR |"; continue
    fi

    # ---- build URL ----
    if [ -n "$REQ_PARAMS" ]; then
      FULL_URL="${BASE_URL}${API_ENDPOINT}?${REQ_PARAMS}"
    else
      FULL_URL="${BASE_URL}${API_ENDPOINT}"
    fi
    echo "    Method  : $METHOD"
    echo "    URL     : $FULL_URL"
    echo "    Mode    : $MODE"
    [ -n "$REQ_PAYLOAD" ] && echo "    Payload : $REQ_PAYLOAD"

    # ---- fire request ----
    START_TIME=$(date +%s%3N)
    if [ -n "$REQ_PAYLOAD" ]; then
      RESPONSE=$(curl -s --max-time $CURL_TIMEOUT -w "\n%{http_code}" \
        -X "$METHOD" \
        -H "accept: application/json" -H "Content-Type: application/json" \
        -H "Authorization: Bearer $AUTH_TOKEN_SERVICE" \
        -d "$REQ_PAYLOAD" "$FULL_URL")
    else
      RESPONSE=$(curl -s --max-time $CURL_TIMEOUT -w "\n%{http_code}" \
        -X "$METHOD" \
        -H "accept: application/json" \
        -H "Authorization: Bearer $AUTH_TOKEN_SERVICE" \
        "$FULL_URL")
    fi
    CURL_EXIT=$?
    END_TIME=$(date +%s%3N)
    RESPONSE_TIME=$((END_TIME - START_TIME))

    if [ $CURL_EXIT -ne 0 ]; then
      if [ $CURL_EXIT -eq 28 ]; then
        CURL_ERROR="Request timed out after ${CURL_TIMEOUT}s"
      else
        CURL_ERROR="Network error or server unreachable (curl exit: $CURL_EXIT)"
      fi
      echo "    ERROR   : $CURL_ERROR"
      echo "    RESULT  : FAIL"
      record_fail "$LABEL" "$CURL_ERROR"
      add_summary "| $LABEL | $SDESC | $MODE | FAIL |"; continue
    fi

    ACTUAL_STATUS=$(echo "$RESPONSE" | tail -1)
    ACTUAL_BODY=$(echo "$RESPONSE" | head -n -1)
    echo "    Status  : $ACTUAL_STATUS (expected: $EXP_STATUS)"
    echo "    Time    : ${RESPONSE_TIME}ms"

    # ---- status check (always first) ----
    if [ "$ACTUAL_STATUS" != "$EXP_STATUS" ]; then
      echo "    RESULT  : FAIL"
      record_fail "$LABEL" "URL: $METHOD $FULL_URL
Status: expected=$EXP_STATUS actual=$ACTUAL_STATUS"
      add_summary "| $LABEL | $SDESC | $MODE | FAIL |"; continue
    fi

    VALIDATION_DIFF=""
    TRIMMED_BODY=$(echo "$ACTUAL_BODY" | tr -d '[:space:]')

    # ---- status-only idiom: CONTAINS {} with no fields/file ----
    if [ "$MODE" = "CONTAINS" ] && [ "$EXP_INLINE" = "{}" ] && [ -z "$EXP_FILE" ] && [ "$FIELDS" = "[]" ]; then
      echo "    RESULT  : PASS (status-only)"
      PASSED=$((PASSED + 1))
      add_summary "| $LABEL | $SDESC | $MODE | PASS |"; continue
    fi

    # ---- empty body handling ----
    if [ -z "$TRIMMED_BODY" ]; then
      if [ "$EXP_STATUS" = "204" ] && [ "$MODE" != "EXISTS" ] && { [ "$EXP_INLINE" = "{}" ] || [ -z "$EXP_INLINE" ]; }; then
        echo "    RESULT  : PASS (204 no content)"
        PASSED=$((PASSED + 1))
        add_summary "| $LABEL | $SDESC | $MODE | PASS |"; continue
      fi
      echo "    RESULT  : FAIL (empty response body)"
      record_fail "$LABEL" "Empty response body (status $ACTUAL_STATUS)"
      add_summary "| $LABEL | $SDESC | $MODE | FAIL |"; continue
    fi

    # ---- valid JSON required for all body modes ----
    if ! echo "$ACTUAL_BODY" | jq . > /dev/null 2>&1; then
      echo "    RESULT  : FAIL (response is not valid JSON)"
      record_fail "$LABEL" "Response body is not valid JSON"
      add_summary "| $LABEL | $SDESC | $MODE | FAIL |"; continue
    fi

    # ---- resolve expected body (file wins over inline) for EXACT/CONTAINS/IGNORE ----
    EXPECTED_BODY="$EXP_INLINE"
    if [ -n "$EXP_FILE" ] && [ "$MODE" != "EXISTS" ]; then
      FULL_EXP="${SERVICE_DIR}${EXP_FILE}"
      if [ ! -f "$FULL_EXP" ]; then
        echo "    RESULT  : FAIL (expected_response_file not found)"
        record_fail "$LABEL" "expected_response_file not found: $FULL_EXP"
        add_summary "| $LABEL | $SDESC | $MODE | FAIL |"; continue
      fi
      if ! EXPECTED_BODY=$(jq -c . "$FULL_EXP" 2>/dev/null); then
        echo "    RESULT  : FAIL (expected_response_file invalid JSON)"
        record_fail "$LABEL" "expected_response_file is not valid JSON: $FULL_EXP"
        add_summary "| $LABEL | $SDESC | $MODE | FAIL |"; continue
      fi
    fi

    # ---- dispatch ----
    TEST_PASSED=true
    case "$MODE" in
      EXACT)    validate_exact    "$ACTUAL_BODY" "$EXPECTED_BODY"            || TEST_PASSED=false ;;
      CONTAINS) validate_contains "$ACTUAL_BODY" "$EXPECTED_BODY"            || TEST_PASSED=false ;;
      IGNORE)   validate_ignore   "$ACTUAL_BODY" "$EXPECTED_BODY" "$EXCLUDED" || TEST_PASSED=false ;;
      EXISTS)   validate_exists   "$ACTUAL_BODY" "$FIELDS"                   || TEST_PASSED=false ;;
    esac

    if [ "$TEST_PASSED" = true ]; then
      echo "    RESULT  : PASS"
      PASSED=$((PASSED + 1))
      add_summary "| $LABEL | $SDESC | $MODE | PASS |"
    else
      echo "    RESULT  : FAIL"
      print_response_body "$ACTUAL_BODY"
      record_fail "$LABEL" "URL: $METHOD $FULL_URL
$VALIDATION_DIFF"
      add_summary "| $LABEL | $SDESC | $MODE | FAIL |"
    fi
  done
done

add_summary ""

# ===========================================================================
# STEP 5: FINAL SUMMARY
# ===========================================================================
TOTAL_END_TIME=$(date +%s%3N)
TOTAL_TIME=$((TOTAL_END_TIME - TOTAL_START_TIME))
TOTAL_TIME_SEC=$(awk "BEGIN {printf \"%.2f\", $TOTAL_TIME/1000}")
TOTAL=$((PASSED + FAILED))

print_header "TEST FAILURES"
if [ $FAILED -gt 0 ]; then printf '%s' "$FAILED_DETAILS"; else echo "   No failures"; fi

print_header "FINAL RESULTS"
echo ""
echo "   Total  : $TOTAL"
echo "   Passed : $PASSED"
echo "   Failed : $FAILED"
echo ""
if [ $FAILED -eq 0 ]; then echo "   ALL TESTS PASSED"; EXIT_CODE=0; else echo "   $FAILED TEST(S) FAILED"; EXIT_CODE=1; fi
echo ""

if [ $FAILED -gt 0 ]; then
  add_summary ""
  add_summary "### Test Failures"
  add_summary '```'
  printf '%s' "$FAILED_DETAILS" >> "$GITHUB_STEP_SUMMARY" 2>/dev/null || true
  add_summary '```'
fi
add_summary "### Summary"
add_summary "| Total | Passed | Failed | Time (s) |"
add_summary "|-------|--------|--------|----------|"
add_summary "| $TOTAL | $PASSED | $FAILED | $TOTAL_TIME_SEC |"

exit $EXIT_CODE

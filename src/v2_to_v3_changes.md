# BOS-NRT — v2 → v3 Change Summary (section-wise)

A readable walk through the runner, section by section: what stayed the same,
what changed, and why.

---

## Legend

- **KEPT** — logic carried over from v2 unchanged (or cosmetic-only edits)
- **CHANGED** — modified behaviour
- **NEW** — did not exist in v2

---

## Constants (top of file)

| | |
|---|---|
| **KEPT** | `CURL_TIMEOUT`, `PASSED` / `FAILED` / `FAILURE_COUNT` / `FAILED_DETAILS`, the `TOKENINFO_URL` selection by environment. |
| **CHANGED** | Environment `case` now accepts `uat` (mapped to the `sgconnect-hom` tokeninfo host). v2 only handled `dev|local|hom` and would hard-crash on `uat`. *(One open question — confirm uat really uses the same tokeninfo host as dev.)* |
| **NEW** | `CONTAINS_DEF` — a jq helper function (`contains_strict`) used by the new CONTAINS mode for strict, recursive, same-object containment. |

---

## Helpers

| | |
|---|---|
| **KEPT** | `add_summary`, `print_header`, `print_divider`, `print_response_body` — unchanged. |
| **NEW** | `normalize_path` — turns a field token like `id` into a jq path `.id`, so both simple keys and jq-paths work. |
| **NEW** | `record_fail` — one place that bumps the counters and appends a numbered failure. In v2 this same block was copy-pasted ~10 times inline. |
| **NEW** | `validate_exact`, `validate_contains`, `validate_ignore`, `validate_exists` — the four modes pulled out into functions. In v2 they lived inline inside one big `case`. |

---

## Step 1 — Input validation

| | |
|---|---|
| **KEPT** | All of it. Same checks: `SERVICE`, `AUTH_TOKEN_SERVICE`, `BASE_URL`, and `AUTH_TOKEN_ACCESS` required unless testing access-management. |
| **CHANGED** | Cosmetic only — collapsed some `if` blocks to one-liners. No logic change. |

---

## Step 2 — Token validation

| | |
|---|---|
| **KEPT** | **Entire section, verbatim from v2.** Service-token tokeninfo call, curl-exit / timeout handling, empty-response check, JSON-validity check, `.error` check, email extraction (`.subname // .sub // .email`), expiry, scopes — then the same again for the access token (skipped when service = access-management). |
| **CHANGED** | Nothing logical. |
| **NEW** | Nothing. |

> This is the part that was already proven correct in v2. It was carried over as-is.

---

## Step 3 — User metadata

| | |
|---|---|
| **KEPT** | The whole flow: URL-encode email, pick metadata token (service token if testing access-management, else access token), call `/users/{email}`, non-blocking warnings on failure, print name / roles. |
| **CHANGED** | One small robustness add: `GIVEN_NAME` / `SURNAME` are initialised to `"N/A"` up front, so the summary never breaks if the metadata call fails. |

---

## Step 4 — Test execution  *(the real rewrite)*

This is where almost all the change lives.

### Discovery
| | |
|---|---|
| **CHANGED** | v2 looped `request/*_request.json` and paired each one to a `response/` file. v3 loops `testApi/<service>/*.json` directly (top-level only, so `expected/` is skipped) and derives `API_NAME` from the filename. |

### File-level checks
| | |
|---|---|
| **NEW** | Before running a file: valid JSON, `method` present, `api_endpoint` present, `test_suite` present and non-empty. |

### Scenario loop
| | |
|---|---|
| **CHANGED** | Instead of one test per file, each file has a `test_suite[]`. Iterated by index (`for ((i=0; i<LEN; i++))`) — index-based on purpose, to avoid the bash subshell trap where `\| while read` silently loses the PASSED/FAILED counters. |

### Scenario-level guards
| | |
|---|---|
| **NEW** | Duplicate `test_name`, missing `test_name` (falls back to `scenario_N`), missing `expected_status`, missing `mode`, unknown mode, and `request_params` containing `&amp;`. |

### Field names (schema)
| | |
|---|---|
| **CHANGED** | `endpoint` → `api_endpoint` (now API-level), `query_params` → `request_params`, `body` → `request_payload`, `expectedStatus` → `expected_status`, `validation` → `validation_config`, `expectedResponse` → `expected_response`. IGNORE now reads `excluded_fields`. |

### Request firing
| | |
|---|---|
| **KEPT** | The curl call itself (status-capture via `-w "\n%{http_code}"`, payload vs no-payload branch, timeout / network-error handling, response-time timing). Same as v2. |

### New body-handling behaviours
| | |
|---|---|
| **NEW** | Status-only idiom: `CONTAINS` + empty `expected_response` (`{}`) checks status only, skips the body. |
| **NEW** | `204 No Content` empty-body allowance for non-EXISTS modes. |
| **NEW** | `expected_response_file` resolution (file wins over inline; missing / invalid-JSON file is a clear failure). |

### Validation modes
| | |
|---|---|
| **CHANGED** | The inline `case "$MODE"` block became calls to the four functions. All four now understand nested objects and arrays: |
| | • **EXACT** — recursive deep-equal (key order ignored, array order matters). |
| | • **IGNORE** — strips fields from *every array element* (`.elements[].id`), not just top-level keys. |
| | • **CONTAINS** — recursive-descent search; finds the subset anywhere, enforces same-object matching, equality not substring. |
| | • **EXISTS** — supports jq-paths and `[]` wildcards, with non-empty checks (`null`/`""`/`[]`/`{}` fail; `0`/`false` pass). |

### Reporting
| | |
|---|---|
| **CHANGED** | Test labels are now `apiName.testName` (was `service/testName`). |
| **CHANGED** | Every summary table row now has the full 4 columns. v2 emitted some malformed 2-column rows. |
| **FIXED** | v2 bug: `${TEST_DIFF` (an unclosed `${...}`) in the failure-accumulation line, which would have broken failure output. |

---

## Step 5 — Final summary

| | |
|---|---|
| **KEPT** | Structure is the same: print numbered failures, totals, timing, write the Final Results table to the Job Summary, exit 0 (all pass) / 1 (any fail). |
| **CHANGED** | Failure details now use real newlines (via `record_fail` + `printf`) instead of embedded `\n` strings, so diffs render cleanly in the GitHub Job Summary. |

---

## One-line takeaway

**Steps 1–3 are your proven v2 logic preserved (only `uat` added + a tiny
metadata-default).  Step 4 is the rewrite — new discovery, suite loop, schema
guards, and the four smarter validators.  Step 5 is v2 with a newline-rendering
cleanup.**

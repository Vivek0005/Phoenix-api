# BOS-NRT — Non Regression Testing Engine

Data-driven regression testing for Back Office Services (BOS) APIs. After a
deployment, the engine fires real HTTP requests at BOS APIs and checks the
responses still match what is expected — catching regressions automatically.

It runs entirely inside GitHub Actions on a self-hosted Linux runner, using
nothing but `bash`, `curl`, `jq` and `diff`. No build toolchain, no runtime
dependencies.

> **v3 change:** test definitions moved from split `request/` + `response/`
> folders to **one JSON file per API**, each holding a `test_suite[]` of
> scenarios. All four validation modes now understand **nested objects and
> arrays**. See [Migrating from v2](#migrating-from-v2).

---

## What is NRT?

For each API you describe the request and the expected response as data. The
engine sends the request, captures the live response, and compares it against
your expectation using one of four validation modes. A clean pass/fail table is
published to the GitHub Actions Job Summary, with numbered diffs for any failure.

Adding a test = adding a scenario to a JSON file. Adding an API = adding a JSON
file. Adding a service = adding a folder. No code changes.

## How it works

```
trigger (workflow_dispatch)
   -> RBAC check (allow-list of GitHub users)
   -> validate service token  (+ access token, unless testing access-management)
   -> fetch user metadata (roles / scopes) for the audit trail
   -> discover testApi/<service>/*.json
   -> for each API file: loop test_suite[]
        build URL -> fire curl -> check status -> validate body (by mode)
   -> publish pass/fail table + numbered failures to the Job Summary
   -> exit 0 (all pass) / 1 (any fail)
```

## Project structure

```
bos-nrt/
├── .github/workflows/
│   └── nrt.yml                     GitHub Actions workflow
├── testApi/
│   └── bos-contract-service/
│       ├── accountsApi.json        one file per API (API meta + test_suite[])
│       ├── currenciesApi.json
│       └── expected/               large expected-response snapshots
│           └── accounts/
│               ├── rootOnly_full.json
│               └── rootOnly_stable.json
├── nrt-runner.sh                   the engine (all logic)
└── README.md
```

Only top-level `*.json` files in a service folder are treated as API test
files, so the `expected/` subfolder is skipped automatically. The API name is
derived from the filename (`accountsApi.json` -> `accountsApi`), and each
scenario is reported as `apiName.testName` (e.g. `accountsApi.rootOnly`).

## Triggering the pipeline

Actions tab -> **NRT - Non Regression Tests** -> **Run workflow**:

| Input | Notes |
|-------|-------|
| Branch | The native ref picker — choose which branch's test files to run. |
| `environment` | `dev` / `uat`. Sets the base URL. |
| `service` | The single service to test this run. |
| `auth_token_service` | Bearer token for the selected service. Copy fresh from Swagger (≈10 min lifetime). |
| `auth_token_access` | Access-management token. **Not required** if `service = bos-access-management-service`. Used to fetch user metadata. |

Only **one service per run** — this keeps each run focused and avoids pasting
many short-lived tokens at once.

## Token logic

| Selected service | `auth_token_service` | `auth_token_access` |
|------------------|----------------------|---------------------|
| `bos-access-management-service` | required | not needed (one token covers both) |
| any other service | required | required |

## RBAC — access control

The first workflow step checks `github.actor` against the comma-separated
GitHub Secret `NRT_ALLOWED_USERS`. Unauthorized users fail immediately, before
any token is touched. To add/remove someone, edit the secret — no code change.

```
Settings -> Secrets and variables -> Actions -> NRT_ALLOWED_USERS
Value: vivek-narayana,amisha-sinha,amber-username
```

If the secret is missing entirely, the step fails for everyone with a clear
message rather than silently allowing access.

---

## The test file format

```jsonc
{
  "description": "Accounts API - multiple scenarios",   // API-level note
  "method": "GET",                                      // required
  "api_endpoint": "/contract-service/api/v1/accounts",  // required
  "test_suite": [                                       // required, non-empty
    {
      "test_name": "rootOnly",                          // required, unique in file
      "description": "[success] Fetch accounts by root",
      "request_params": "root=70411176",                // optional, default ""
      "request_payload": "",                            // optional, default ""
      "expected_status": 200,                           // required
      "expected_response": {},                          // inline expected body
      "expected_response_file": "",                     // OR a file (wins if set)
      "validation_config": {
        "mode": "EXISTS",                               // required
        "fields": ["totalElements", ".elements[0].iban"],
        "excluded_fields": []
      }
    }
  ]
}
```

Field reference:

| Field | Used by | Meaning |
|-------|---------|---------|
| `method`, `api_endpoint` | all | HTTP method and path (API level). |
| `request_params` | scenario | Query string. `&` must be literal — `&amp;` is rejected. |
| `request_payload` | scenario | Body for POST/PUT; empty for GET. |
| `expected_status` | scenario | Expected HTTP status, checked first. |
| `expected_response` | EXACT, CONTAINS, IGNORE | Inline expected body. |
| `expected_response_file` | EXACT, CONTAINS, IGNORE | Path under the service folder; **wins over inline** if set. |
| `validation_config.mode` | all | `EXACT` / `CONTAINS` / `IGNORE` / `EXISTS`. |
| `validation_config.fields` | EXISTS | Paths that must exist and be non-empty. |
| `validation_config.excluded_fields` | IGNORE | Paths stripped before comparing. |

**Field paths** accept a simple key (`totalElements`) or a jq path
(`.elements[0].iban`). `[]` is an array wildcard (`.elements[].iban` = every
element).

---

## Validation modes

All four understand nested objects and arrays.

### EXACT
The whole response must equal `expected_response` exactly (keys sorted, so key
order doesn't matter; **array order does**). Best for fully deterministic
responses (health checks, static reference data). Breaks on any dynamic field
(`id`, timestamps) — use IGNORE for those.

### IGNORE
Strip `excluded_fields` from **both** expected and actual, then EXACT-compare
the rest. Paths may target nested array fields:

```json
"validation_config": {
  "mode": "IGNORE",
  "excluded_fields": [".elements[].id", ".elements[].creationDate"]
}
```

### CONTAINS
`expected_response` is a subset template. It passes if **some object anywhere**
in the response contains it (recursive search). Multi-field expectations must be
satisfied **within the same object**, so this does not falsely pass when the
values are scattered across different objects:

```json
// passes only if one account is BOTH EUR and OPEN
"expected_response": { "currency": "EUR", "status": "OPEN" }
```

Scalar values are matched by **equality**, not substring (`"FR"` ≠ `"FRANCE"`).
An empty `expected_response` (`{}`) means **status-only** — body is not checked.

### EXISTS
Each path in `fields` must be present and **non-empty**. Empty =
`null`, `""`, `[]`, `{}`. Concrete `0` and `false` count as present (they are
real values). Array wildcards require **every** element to have the field:

```json
"fields": [".elements[].iban", ".elements[].status"]
```

### Array semantics summary

| Mode | Array behaviour |
|------|-----------------|
| EXACT | every element must match exactly (order matters) |
| IGNORE | listed fields stripped from every element |
| CONTAINS | at least one element must contain the expected object |
| EXISTS | every element must have the field non-empty |

---

## Adding a new API test

1. Pick the service folder `testApi/<service>/`.
2. Add a scenario object to the relevant `<apiName>.json` `test_suite[]`
   (or create a new `<apiName>.json`).
3. For large expected bodies, drop a file under `expected/<api>/` and point
   `expected_response_file` at it (relative to the service folder).

## Adding a new service

1. Create `testApi/<new-service>/` with one or more `<apiName>.json` files.
2. Add the service name to the `service` dropdown in `nrt.yml`.
3. If it needs a brand-new token, add a workflow input and a token branch in the
   engine (a few lines). If it shares an existing token, no code change.

## Running locally

```bash
export ENVIRONMENT=dev
export SERVICE=bos-contract-service
export BASE_URL=https://bo-services-dev.fr.world.socgen
export AUTH_TOKEN_SERVICE="<token from Swagger>"
export AUTH_TOKEN_ACCESS="<access-management token>"
bash nrt-runner.sh
```

## Edge cases handled

Invalid JSON test file; missing `method` / `api_endpoint` / `test_suite`;
empty `test_suite`; duplicate `test_name`; missing `test_name` (falls back to
`scenario_N`); missing `expected_status`; missing / unknown `validation.mode`;
`request_params` containing `&amp;`; missing or invalid `expected_response_file`;
curl timeout (exit 28) vs network/unreachable; status mismatch; non-JSON body;
empty body (with `204 No Content` allowance); oversized response bodies
(truncated to 20 lines in logs); multiple numbered failures.

## Known limitations

- Tokens are pasted manually and expire in ~10 minutes (CI has no browser /
  Kerberos session for SG Connect's implicit flow). Long-term fix: a self-hosted
  runner holding an active Kerberos session, or a service account.
- One service per run, by design.
- Sequential execution (parallelism deferred until there are many more APIs).

## Tech stack

`bash` · `curl` · `jq` · `diff` · GitHub Actions · GitHub Secrets.

## Migrating from v2

- **v2:** `request/<name>_request.json` + `response/<name>_response.json` per
  test; engine looped both folders.
- **v3:** one `<apiName>.json` per API with a `test_suite[]`; expected bodies
  inline or under `expected/`.
- Field renames: `endpoint` -> `api_endpoint` (API level), `query_params` ->
  `request_params`, `body` -> `request_payload`, `expectedStatus` ->
  `expected_status`, `validation` -> `validation_config`, `expectedResponse` ->
  `expected_response`. IGNORE now reads `excluded_fields`.
- Reporting changed from `service/testName` to `apiName.testName`.

## Maintainers

Vivek Narayana — Team GSCI / GTO / LUX / BOS.

# BOS-NRT — Non Regression Test Framework

A lightweight, shell-based Non Regression Testing (NRT) framework for Back Office Services APIs. Built to run inside GitHub Actions with zero external dependencies.

---

## What Is NRT?

Non Regression Testing ensures that APIs continue to behave as expected after code changes. Instead of manually testing APIs after every deployment, this framework automates the process — fire requests, compare responses, report results.

> If something changed that shouldn't have, NRT catches it.

---

## How It Works

```
You trigger the pipeline manually
          ↓
Paste Bearer tokens from Swagger
          ↓
Select target environment (dev / uat)
          ↓
Framework validates both tokens
          ↓
Prints user metadata (name, roles, department)
          ↓
Iterates over all test folders automatically
          ↓
Fires each API request via curl
          ↓
Compares actual response against expected
          ↓
Prints clean pass/fail table in GitHub UI
          ↓
Shows diff for any failures
```

---

## Project Structure

```
bos-nrt/
├── .github/
│   └── workflows/
│       └── nrt.yml              ← GitHub Actions workflow
├── testApi/
│   └── bos-contract-service/    ← one folder per service
│       ├── request/
│       │   ├── healthCheck_request.json
│       │   └── currencyApi_request.json
                ........
│       └── response/
│           ├── healthCheck_response.json
│           └── currencyApi_response.json
                ........
├── nrt-runner.sh                ← core engine
└── README.md
```

---

## Triggering The Pipeline

1. Go to your repository on SGithub
2. Click **Actions** tab
3. Select **NRT - Non Regression Tests**
4. Click **Run workflow**
5. Fill in the inputs:

| Input                 | Description                                            |
| --------------------- | ------------------------------------------------------ |
| `environment`         | Select `dev` or `uat`                                  |
| `auth_token_contract` | Bearer token for contract-service (copy from Swagger)  |
| `auth_token_access`   | Bearer token for access-management (copy from Swagger) |

6. Click **Run workflow**

> Tokens expire in 10 minutes. Copy them from Swagger just before triggering.

---

## Adding A New API Test

No code changes needed. Just add JSON files.

**Step 1 — Create request file**

`testApi/bos-contract-service/request/myApi_request.json`

```json
{
  "_comment": "Description of what this API does",
  "method": "GET",
  "endpoint": "/contract-service/api/v1/my-endpoint",
  "query_params": "param1=value1&param2=value2",
  "body": "",
  "token_type": "contract"
}
```

**Step 2 — Create response file**

`testApi/bos-contract-service/response/myApi_response.json`

```json
{
  "_comment": "Expected response for myApi",
  "expectedStatus": 200,
  "validation": {
    "mode": "EXISTS",
    "fields": ["fieldName"]
  },
  "expectedResponse": {}
}
```

**Step 3 — Push and trigger**

That's it. The engine discovers new files automatically.

---

## Adding A New Service

Create a new folder under `testApi/`:

```
testApi/
  bos-contract-service/     ← existing
  bos-access-management/    ← new service
    request/
      usersApi_request.json
    response/
      usersApi_response.json
```

The engine loops over all service folders automatically. No code changes needed.

---

## Request File Reference

| Field          | Required | Description                                                                  |
| -------------- | -------- | ---------------------------------------------------------------------------- |
| `method`       | Yes      | HTTP method — `GET`, `POST`, `PUT`, `DELETE`, `PATCH`                        |
| `endpoint`     | Yes      | API path including service prefix e.g. `/contract-service/api/v1/currencies` |
| `query_params` | No       | Query string e.g. `sortBy=ccyCode&sortingOrder=asc`                          |
| `body`         | No       | Request body for POST/PUT. Leave empty for GET                               |
| `token_type`   | No       | `contract` (default) or `access`. Determines which token is used             |
| `_comment`     | No       | Human-readable description. Ignored by engine                                |

---

## Response File Reference

| Field               | Required | Description                                         |
| ------------------- | -------- | --------------------------------------------------- |
| `expectedStatus`    | Yes      | Expected HTTP status code e.g. `200`, `404`         |
| `validation.mode`   | Yes      | Comparison mode — see below                         |
| `validation.fields` | Depends  | Field list used by `IGNORE` and `EXISTS` modes      |
| `expectedResponse`  | Yes      | Expected response body. Can be `{}` for EXISTS mode |
| `_comment`          | No       | Human-readable description. Ignored by engine       |

---

## Validation Modes

### EXACT

Every field must match exactly. Extra fields in actual response = FAIL.

Use when the response is fully locked down and nothing should change.

```json
"validation": {
  "mode": "EXACT",
  "fields": []
},
"expectedResponse": {
  "message": "UP"
}
```

---

### CONTAINS

All fields in `expectedResponse` must match. Extra fields in actual response are ignored.

Use when the API returns additional metadata you don't care about.

```json
"validation": {
  "mode": "CONTAINS",
  "fields": []
},
"expectedResponse": {
  "status": "SUCCESS",
  "message": "OK"
}
```

---

### IGNORE

Listed fields are stripped from the actual response before comparing everything else.

Use for dynamic fields like `timestamp`, `id`, `createdAt` that change on every request.

```json
"validation": {
  "mode": "IGNORE",
  "fields": ["timestamp", "id"]
},
"expectedResponse": {
  "status": "SUCCESS"
}
```

---

### EXISTS

Only checks that listed fields exist in the actual response. Values are not checked at all.

Use when a field must always be present but its value changes (e.g. `totalElements`).

```json
"validation": {
  "mode": "EXISTS",
  "fields": ["totalElements", "elements"]
},
"expectedResponse": {}
```

---

## What The Output Looks Like

### GitHub Job Summary (pass Example)

| Test        | Status | Time  | Details |
| ----------- | ------ | ----- | ------- |
| healthCheck | PASS   | 37ms  | -       |
| currencyApi | PASS   | 285ms | -       |

**Final Results**

| Total | Passed | Failed |
| ----- | ------ | ------ |
| 2     | 2      | 0      |

---

### GitHub Job Summary (fail Example)

| Test        | Status | Time  | Details           |
| ----------- | ------ | ----- | ----------------- |
| healthCheck | PASS   | 37ms  | -                 |
| currencyApi | FAIL   | 161ms | See details below |

**Failed Test Details**

```
[FAIL] bos-contract-service/currencyApi
  Field 'totalElements' not found in response
```

---

## Authentication

This framework uses two separate Bearer tokens:

| Token                 | Purpose                                                     |
| --------------------- | ----------------------------------------------------------- |
| `auth_token_contract` | Used to call contract-service APIs                          |
| `auth_token_access`   | Used to call access-management APIs and fetch user metadata |

(Same goes for other services)

All tokens are validated against the SG Connect tokeninfo endpoint before any tests run. If either token is expired, the pipeline fails immediately with a clear message.

Tokens are obtained from Swagger and pasted manually at pipeline trigger time. This is a known limitation of the OIDC implicit flow used by SG Connect — token generation requires a browser session and cannot be fully automated.

---

## Token Validation Flow

```
Hit tokeninfo endpoint for contract-service token
          ↓
Check token is not expired
          ↓
Extract user email from token
          ↓
Hit tokeninfo endpoint for access-management token
          ↓
Check token is not expired
          ↓
Hit access-management API with user email
          ↓
Print: name, department, IGG, roles, privilege groups
```

---

## Edge Cases Handled

| Scenario                                   | Behaviour                                     |
| ------------------------------------------ | --------------------------------------------- |
| Token expired or invalid                   | Pipeline fails immediately with clear message |
| tokeninfo endpoint unreachable             | Pipeline fails immediately                    |
| User metadata unreachable                  | Warning printed, tests continue               |
| testApi folder missing                     | Pipeline fails with clear message             |
| Service folder has no request folder       | Service skipped with warning                  |
| Service folder has no response folder      | Service skipped with warning                  |
| No request files in folder                 | Service skipped with warning                  |
| Response file missing for a request        | That test marked as FAIL                      |
| `method` missing in request file           | That test marked as FAIL                      |
| `endpoint` missing in request file         | That test marked as FAIL                      |
| `expectedStatus` missing in response file  | That test marked as FAIL                      |
| `validation.mode` missing in response file | That test marked as FAIL                      |
| Unknown validation mode                    | That test marked as FAIL                      |
| curl timeout (30s)                         | That test marked as FAIL with timeout message |
| Network error / server unreachable         | That test marked as FAIL with curl exit code  |
| Response is not valid JSON                 | That test marked as FAIL                      |
| Response body too large                    | Truncated to 20 lines in logs                 |

---

## Tech Stack

| Tool           | Purpose                      |
| -------------- | ---------------------------- |
| `bash`         | Shell scripting              |
| `curl`         | HTTP requests                |
| `jq`           | JSON parsing and comparison  |
| `diff`         | Response diffing             |
| GitHub Actions | CI/CD pipeline and reporting |

No external dependencies. No build tools. No package managers. Runs on any Linux machine with curl and jq installed.

---


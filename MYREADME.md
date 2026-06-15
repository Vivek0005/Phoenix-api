# BOS-NRT — Framework

A lightweight, shell-based Non Regression Testing (NRT) framework for APIs. Built to run inside GitHub Actions with zero external dependencies.

---

## What Is NRT?

Non Regression Testing ensures that APIs continue to behave as expected after code changes. Instead of manually testing APIs after every deployment, this framework automates the process — fire requests, compare responses, report results.

> If something changed that shouldn't have, NRT catches it.

---

## How It Works

```
Paste Bearer token(s) from Swagger
          ↓
RBAC check — only authorized users can run
          ↓
Framework validates token(s)
          ↓
Prints user metadata (name, roles, department)
          ↓
Runs all tests for the selected service
          ↓
Fires each API request via curl
          ↓
Compares actual response against expected
          ↓
Prints clean pass/fail table in GitHub UI
          ↓
Shows numbered diff for any failures
```

---

## Project Structure

```
bos-nrt/
├── .github/
│   └── workflows/
│       └── nrt.yml                        ← GitHub Actions workflow
├── testApi/
│   ├── bos-contract-service/              ← one folder per service
│   │   ├── request/
│   │   │   ├── healthCheck_request.json
│   │   │   └── currencyApi_request.json
│   │   └── response/
│   │       ├── healthCheck_response.json
│   │       └── currencyApi_response.json
│   └── bos-access-management/
│       ├── request/
│       │   ├── healthCheck_request.json
│       │   └── getUsersApi_request.json
│       └── response/
│           ├── healthCheck_response.json
│           └── getUsersApi_response.json
├── nrt-runner.sh                          ← core engine
└── README.md
```

---

## Triggering The Pipeline

1. Go to your repository on SGithub
2. Click **Actions** tab
3. Select **NRT - Non Regression Tests**
4. Click **Run workflow**
5. Fill in the inputs:

| Input                | Description                                               | Required                                  |
| -------------------- | --------------------------------------------------------- | ----------------------------------------- |
| `environment`        | Select `dev` or `uat`                                     | Yes                                       |
| `service`            | Select which service to test                              | Yes                                       |
| `auth_token_service` | Bearer token for the selected service (copy from Swagger) | Yes                                       |
| `auth_token_access`  | Bearer token for access-management (copy from Swagger)    | Only if service ≠ `bos-access-management` |

6. Click **Run workflow**

> Tokens expire in 10 minutes. Copy them from Swagger just before triggering.

---

## RBAC — Access Control

Only authorized users can trigger the NRT pipeline. Authorization is managed via a GitHub Secret.

**Setting up authorized users (repo admin only):**

```
Go to repo → Settings → Secrets and variables → Actions
Add secret:
  Name  : NRT_ALLOWED_USERS
  Value : vivek-narayana,amisha-sinha,...
```

If an unauthorized user tries to trigger the pipeline:

```
ERROR: User 'username' is not authorized to run NRT pipeline
```

To add or remove users — update the secret.

---

## Adding A New API Test

No code changes needed. Just add JSON files.

### Step 1 — Create request file

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

### Step 2 — Create response file

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

### Step 3 — Push and trigger

That's it. The engine discovers new files automatically.

---

## Adding A New Service

### Step 1 — Create folder structure

```
testApi/
  bos-new-service/
    request/
      myApi_request.json
    response/
      myApi_response.json
```

### Step 2 — Add service to workflow dropdown

In `nrt.yml` add the service name to the options list:

```yaml
service:
  type: choice
  options:
    - bos-contract-service
    - bos-access-management
    - bos-new-service        ← add this
```

### Step 3 — Push and trigger

Done. No other code changes needed.

---

## Request File Reference

| Field          | Required | Description                                                      |
| -------------- | -------- | ---------------------------------------------------------------- |
| `method`       | Yes      | HTTP method — `GET`, `POST`, `PUT`, `DELETE`, `PATCH`            |
| `endpoint`     | Yes      | Full API path e.g. `/contract-service/api/v1/currencies`         |
| `query_params` | No       | Query string e.g. `sortBy=ccyCode&sortingOrder=asc`              |
| `body`         | No       | Request body for POST/PUT. Leave empty for GET                   |
| `token_type`   | No       | `contract` (default) or `access`. Determines which token is used |
| `_comment`     | No       | Human-readable description. Ignored by engine                    |

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

## What The Output Looks Like (Example)

### GitHub Job Summary (all pass)

```
Environment: dev | Base URL: https://bo-services-dev.fr.world.socgen | Service: bos-contract-service | User: vivek.narayana@socgen.com

bos-contract-service
Test            Status     Time    Details
healthCheck     ✅ PASS    37ms    -
currencyApi     ✅ PASS    285ms   -

Final Results
Total    Passed    Failed
2        2 ✅      0 ❌
```

### GitHub Job Summary (with failures)

```
bos-contract-service
Test            Status     Time    Details
healthCheck     ✅ PASS    37ms    -
currencyApi     ❌ FAIL    161ms   See details below

Failed Test Details
1. [FAIL] bos-contract-service/currencyApi
   Field 'totalElements' not found in response

2. [FAIL] bos-contract-service/healthCheck
   Status : expected=200 actual=503
```

---

## Edge Cases Handled

| Scenario | Behaviour |
|---|---|
| Unauthorized user triggers pipeline | RBAC check fails immediately |
| Token expired or invalid | Pipeline fails immediately |
| `auth_token_access` missing for non-access service | Pipeline fails with clear message |
| Response file missing for a request | That test marked as FAIL |
| curl timeout (30s) | That test marked as FAIL with timeout message |
| Network error / server unreachable | That test marked as FAIL with curl exit code |
| Response is not valid JSON | That test marked as FAIL |
| Multiple failures | All shown numbered at end (1. 2. 3.) |

---

## Tech Stack

| Tool           | Purpose                      |
| -------------- | ---------------------------- |
| `bash`         | Shell scripting              |
| `curl`         | HTTP requests                |
| `jq`           | JSON parsing and comparison  |
| `diff`         | Response diffing             |
| GitHub Actions | CI/CD pipeline and reporting |
| GitHub Secrets | RBAC user management         |

No external dependencies. No build tools. No package managers. Runs on any Linux machine with `curl` and `jq` installed.

---


NRT Framework — Multiple
Test Cases Per API: Design
Document
Document purpose
This document captures the design decision for
supporting multiple test cases for the same API in
the BOS-NRT framework, without duplicating API
definitions. It covers the problem, every approach
considered with full realistic examples, the
recommended approach, the edge cases and
refinements, the exact engine code change required,
and an analysis of whether the four existing validation
modes are sufficient (including the code for how a
new mode would be added if ever needed).
It is written to be self-contained — someone (or
another AI assistant) reading only this document
should fully understand the problem and the chosen
solution. 1. Background — what the framework
does today
The BOS-NRT framework is a shell-based Non
Regression Testing engine for Back Office Services
APIs. It runs inside GitHub Actions using curl , jq ,
and diff — no Java, no Python, no build tools, no
dependencies.
For every API, two JSON files are stored:
a request file describing what to send ( method ,
endpoint , query_params , body , token_type )
a response file describing what is expected back
( expectedStatus , validation.mode ,
validation.fields , expectedResponse )
The engine fires the real HTTP request, captures the
live response, and compares it against the expected
response using one of four validation modes (EXACT,
CONTAINS, IGNORE, EXISTS). Results are published
as a pass/fail table in the GitHub Actions job
summary, with numbered failure details and diffs.
The framework is data-driven: adding an API today
means dropping a request/response file pair into a
service folder. No code change is required. 2. The problem
Today the framework supports one test case per API
per file.
But a single API usually needs to be tested under
many scenarios. Take getUsers :
Case 1: size=10 
-> expect 200 (1 query param)
Case 2: size=10&page=2 
-> expect 200 (2 query params)
Case 3: size=10&page=2&sortBy=username 
-> expect 200 (3 query params)
Case 4:
size=10&page=2&sortBy=username&sortOrder=as
c -> expect 200 (4 query params)
Case 5: (no params, service applies
defaults) -> expect 200 (0 query
params)
Case 6: page=-1 
-> expect 400 (invalid input)
Note two distinct dimensions of variation here:
1. Different values for the same parameters (valid vs
invalid vs boundary values).
2. Different numbers of parameters — one case
sends one query param, the next sends two, the
next sends three, and so on. Under the current model, each of these six cases is a
separate request/response file pair, and every one of
those request files repeats the same endpoint,
method, and token_type. Only the query_params
string differs.
Why this is a problem
Repetition of the same API definition (endpoint,
method) across many files.
Poor scalability as the number of test cases
grows. For 6 services x ~10 APIs x ~4 cases each,
that is roughly 480 files, with endpoint strings
copy-pasted everywhere.
Difficulty managing variations (query param and
request body combinations).
Increased maintenance effort and duplication —
if an endpoint path changes, every file for that API
must be edited by hand, and a single missed file
causes silent drift (two "tests for the same API"
hitting different URLs, with nothing flagging it).
The core challenge
How can we design a structured, scalable way to
define and execute multiple test cases for the
same API without duplicating the request/API
definition? Constraints the solution must satisfy
Avoid duplicating API definitions (endpoint,
method).
Be easy to maintain and extend.
Work with the existing framework (shell + curl +
jq) — no new dependencies.
Support different validation modes per test case.
Keep test execution simple and debuggable.
What we are deliberately NOT trying to do
We are not auto-generating every possible
combination of parameters. Four optional query
params would be 2^4 = 16 combinations if
generated exhaustively, most of them
meaningless. We want meaningful coverage (a
representative valid case, boundary cases, invalid
cases) chosen explicitly — not exhaustive
coverage. This avoids combinatorial explosion.
3. Approaches considered
Four approaches were evaluated. Each is shown
below with full, realistic examples using actual BOS
APIs. Approach 1 — One file per case (current
model, scaled out)
Create a separate request + response pair for every
case.
getUsers_validPagination_request.json
{
 "endpoint": "/access-management-
service/api/v1/users",
 "method": "GET",
 "token_type": "access",
 "query_params": "size=10&page=2"
}
getUsers_negativePage_request.json
{
 "endpoint": "/access-management-
service/api/v1/users",
 "method": "GET",
 "token_type": "access",
 "query_params": "size=10&page=-1"
}
getUsers_largeSize_request.json
{
 "endpoint": "/access-management-
service/api/v1/users",
 "method": "GET", "token_type": "access",
 "query_params": "size=1000&page=0"
}
getUsers_defaults_request.json
{
 "endpoint": "/access-management-
service/api/v1/users",
 "method": "GET",
 "token_type": "access",
 "query_params": ""
}
Plus four matching response files. The endpoint ,
method , and token_type are identical and copy-
pasted across all four; only query_params differs.
Dimension Assessment
Scalability
Poor. 4 cases = 8 files. API
definition duplicated 4 times.
Maintainability
Poor. Endpoint change = edit every
file by hand; a missed file = silent
drift.
Debuggability
Excellent. Each file is fully self-
contained, no indirection. Verdict: wins only on simplicity. Loses on the two
things that matter most here (scalability,
maintainability).
Approach 2 — Base file + per-case overrides
(inheritance)
A shared base file holds the common fields. Each
case file declares only its difference and references
the base via an extends field. The engine deep-
merges base + override at runtime with jq .
getUsers_base_request.json
{
 "endpoint": "/access-management-
service/api/v1/users",
 "method": "GET",
 "token_type": "access"
}
getUsers_negativePage_request.json
{
 "extends": "getUsers_base",
 "query_params": "size=10&page=-1"
}
getUsers_largeSize_request.json {
 "extends": "getUsers_base",
 "query_params": "size=1000&page=0"
}
Dimension Assessment
Scalability
Good. The endpoint lives in exactly
one place.
Maintainability
Medium, deceptively risky. You
can no longer open one case file
and see the full request — you
must mentally merge two files.
Merge semantics (shallow vs
deep, what wins) become a silent
bug source.
Debuggability
Worse than Approach 1 because
of the two-file mental merge.
The merge-semantics trap (concrete example):
Consider a POST where the base has body:
{"status":"ACTIVE","region":"FR"} and a case
overrides body: {"status":"INACTIVE"} . Does
region survive the merge or not? It depends entirely
on whether you implement a shallow or deep merge —
and whichever you pick will surprise someone reading
the file later. Verdict: solves duplication but trades away "simple
and debuggable," which the constraints rank highest.
Approach 3 — CSV / data-table driven
A template request plus a CSV table of variations. The
engine loops the rows and substitutes values into the
template.
getUsers_template_request.json
{
 "endpoint": "/access-management-
service/api/v1/users",
 "method": "GET",
 "token_type": "access",
 "query_params": "{{query_params}}"
}
getUsers_cases.csv
caseName,query_params,expectedStatus,mode,f
ields
validPagination,size=10&page=2,200,EXISTS,t
otalElements;elements
negativePage,size=10&page=-1,400,EXISTS,err
or
largeSize,size=1000&page=0,200,EXISTS,total
Elements
defaults,,200,EXISTS,totalElements Dimension Assessment
Scalability
Great for pure query-parameter
sweeps — adding a row is trivial
and compact. This is the one
place CSV shines, because varying
the number of query params is just
a longer string in one column.
Maintainability
Breaks for the real use case. The
moment a case needs a
structured request body
(POST/PUT) or a structured
expectedResponse object to diff
against, you are cramming JSON
into CSV cells.
Debuggability
Medium. Compact but fragile once
escaping is involved.
Where CSV collapses (concrete example): a POST
body in a CSV cell requires escaping quotes and
commas inside a comma-separated file:
caseName,body,expectedStatus
createValid,"
{""status"":""ACTIVE"",""region"":""FR""}",
201
A nested object makes this unreadable, and CSV has
no clean way to express a different expectedResponse object per row for EXACT or
CONTAINS modes.
Verdict: right tool for input-only parameter sweeps,
wrong tool for "different expected results and bodies
per case" — which is exactly what valid/invalid/edge
testing requires.
Approach 4 — Array of cases within the API's
files (RECOMMENDED)
The endpoint, method, and token are declared once
per API. A cases[] array holds each scenario's own
variation. The response file mirrors it with each case's
own expected status, validation mode, and expected
body. Cases are matched between request and
response by name.
This is the recommended approach. Full examples
follow.
4. Recommended approach — full
examples
4.1 GET with varying query parameters (the
getUsers scenario) This demonstrates both dimensions of variation:
different values and different numbers of params. The
critical design choice is that query_params is a
single string per case — so "1 param vs 2 vs 3 vs 4" is
a non-issue, because the engine never counts or
merges params; it simply appends whatever string the
case provides.
getUsersApi_request.json
{
 "endpoint": "/access-management-
service/api/v1/users",
 "method": "GET",
 "token_type": "access",
 "cases": [
 {
 "name": "sizeOnly",
 "description": "1 query param - size
only",
 "query_params": "size=10"
 },
 {
 "name": "sizeAndPage",
 "description": "2 query params - size
and page",
 "query_params": "size=10&page=2"
 },
 {
 "name": "withSort",
 "description": "3 query params - adds
sortBy", "query_params":
"size=10&page=2&sortBy=username"
 },
 {
 "name": "withSortOrder",
 "description": "4 query params - adds
sortOrder",
 "query_params":
"size=10&page=2&sortBy=username&sortOrder=a
sc"
 },
 {
 "name": "defaults",
 "description": "0 query params -
service applies defaults",
 "query_params": ""
 },
 {
 "name": "negativePage",
 "description": "Invalid - negative
page number, expect rejection",
 "query_params": "page=-1"
 }
 ]
}
getUsersApi_response.json
{
 "cases": [
 {
 "name": "sizeOnly",
 "expectedStatus": 200, "validation": { "mode": "EXISTS",
"fields": ["totalElements", "elements"] },
 "expectedResponse": {}
 },
 {
 "name": "sizeAndPage",
 "expectedStatus": 200,
 "validation": { "mode": "EXISTS",
"fields": ["totalElements", "elements"] },
 "expectedResponse": {}
 },
 {
 "name": "withSort",
 "expectedStatus": 200,
 "validation": { "mode": "EXISTS",
"fields": ["totalElements", "elements"] },
 "expectedResponse": {}
 },
 {
 "name": "withSortOrder",
 "expectedStatus": 200,
 "validation": { "mode": "EXISTS",
"fields": ["totalElements", "elements"] },
 "expectedResponse": {}
 },
 {
 "name": "defaults",
 "expectedStatus": 200,
 "validation": { "mode": "EXISTS",
"fields": ["totalElements"] },
 "expectedResponse": {}
 },
 {
 "name": "negativePage", "expectedStatus": 400,
 "validation": { "mode": "EXISTS",
"fields": ["error"] },
 "expectedResponse": {}
 }
 ]
}
Adding "one more param" later is literally appending to
a string in one array element. Nothing in the engine
changes.
4.2 POST with varying request bodies (valid /
invalid / edge)
This demonstrates body variation and three genuinely
different expected outcomes in a single pair — three
expected statuses (201, 400, 400) and three different
validation modes (IGNORE, EXISTS, CONTAINS).
createClaim_request.json
{
 "endpoint": "/contract-
service/api/v1/claims",
 "method": "POST",
 "token_type": "contract",
 "cases": [
 {
 "name": "validClaim",
 "description": "Well-formed claim
payload", "query_params": "",
 "body": "
{\"claimType\":\"CREATE\",\"region\":\"FR\"
,\"amount\":1000}"
 },
 {
 "name": "missingAmount",
 "description": "Required field amount
omitted",
 "query_params": "",
 "body": "
{\"claimType\":\"CREATE\",\"region\":\"FR\"
}"
 },
 {
 "name": "invalidRegion",
 "description": "Region code not
recognised",
 "query_params": "",
 "body": "
{\"claimType\":\"CREATE\",\"region\":\"XX\"
,\"amount\":1000}"
 }
 ]
}
createClaim_response.json
{
 "cases": [
 {
 "name": "validClaim",
 "expectedStatus": 201, "validation": { "mode": "IGNORE",
"fields": ["id", "creationTime"] },
 "expectedResponse": { "claimType":
"CREATE", "region": "FR", "amount": 1000,
"status": "SUCCESS" }
 },
 {
 "name": "missingAmount",
 "expectedStatus": 400,
 "validation": { "mode": "EXISTS",
"fields": ["error"] },
 "expectedResponse": {}
 },
 {
 "name": "invalidRegion",
 "expectedStatus": 400,
 "validation": { "mode": "CONTAINS",
"fields": [] },
 "expectedResponse": { "error":
"INVALID_REGION" }
 }
 ]
}
4.3 Why Approach 4 wins
Dimension Assessment
Scalability
Good. Endpoint once per API; a
new case is one array element.
Growth is "total cases," not "APIs
x cases duplicated." Dimension Assessment
Maintainability
Good. One file = one API = every
scenario visible together.
Endpoint change = one edit in
one place.
Debuggability
Good, provided cases are
matched and reported by name
(see refinements). One file
shows every scenario for the API
at a glance.
Validation
modes
No change needed. Each case
keeps its own mode; the existing
four modes simply get selected
per case instead of per file.
Combinatorial
explosion
Avoided. Cases are listed
explicitly — only the meaningful
ones — never auto-generated.
5. Refinements that make Approach
4 safe (edge cases)
These are the failure modes that bite if not designed
for. They must be part of the implementation. 1. Match cases by name , never by array index. If
request case [0] is paired with response case
[0] , then reordering or inserting a case silently
misaligns every later expectation — a test then
passes against the wrong contract. The engine
must look up the response case whose name
equals the request case's name .
2. Diverging case lists must fail loudly. If a request
case has no matching response case (or vice
versa), mark that case as FAIL/ERROR with a clear
message. Never skip silently — silent skips are
how regressions hide.
3. Report results as apiName.caseName . The
numbered-failure feature and the summary table
must show getUsersApi.negativePage , not just
getUsersApi . Otherwise multiple failures on the
same API are indistinguishable.
4. Backward compatibility — support both file
shapes. Do not force-migrate existing single-case
files. Rule: if a cases array exists, loop over it;
otherwise treat the whole file as a single implicit
case. This keeps existing files (healthCheck,
currencyApi) working untouched, and the array
form is adopted only where multiple cases are
actually needed. Zero-risk migration.
5. Endpoint / method / token stay at the API level;
only query_params and body vary per case. The token type does not change per case for the same
API, so it remains a top-level field. If a malformed-
header test (e.g. to force a 415) is ever needed, a
case object can grow an optional headers field
later with no structural change.
6. Case independence. One case failing must not
abort the others — the existing per-test continue
logic extends to per-case naturally.
Sub-decision: two files vs one file
D1 (recommended now): keep the existing
request/ and response/ folders, add a parallel
cases[] to each, matched by name. Smallest
change, fits the current structure and
documentation, honours "work with the existing
framework." The name-matching risk is fully
contained by refinement #2.
D2 (cleaner in isolation, larger change): one file
per API where each case holds both its request
bits and its expected bits together. No cross-file
name matching, no divergence risk — but it
abandons the request/response folder split and is
a larger refactor.
Choose D1 now. Keep D2 in reserve for a future larger
refactor if cross-file matching ever feels heavy. 6. Engine code change (Approach 4,
decision D1)
The change is small: wrap the existing request-read +
curl-fire + validate block in a per-case loop, and look
up the matching response case by name. The four
validation-mode branches do not change — they run
once per case instead of once per file.
6.1 Conceptual flow
For each request file in the selected
service:
 Read endpoint, method, token_type ONCE
(API-level fields)
 derive apiName from the filename
 If the request file has a .cases array:
 For each CASE in .cases[]:
 caseName = CASE.name
 query_params = CASE.query_params
 body = CASE.body
 Find the response case where
.name == caseName
 -> if none found: mark FAIL
"no matching response case", continue
 Read that response case's
expectedStatus / validation.mode /
 validation.fields /
expectedResponse
 Run the EXISTING logic unchanged: build URL, fire curl, curl-
exit handling, status check,
 JSON-validity check,
validation-mode comparison
 Record the result as
"${apiName}.${caseName}"
 Else:
 Treat the whole file as a single
implicit case (current behaviour,
untouched)
6.2 Shell implementation (drop-in for the per-
file test block)
This replaces the section of nrt-runner.sh that
currently reads a single request file and fires one
request. It assumes the surrounding service-folder
loop, token handling, BASE_URL , helper functions
( add_summary , print_response_body ), and the
counters ( PASSED , FAILED , FAILURE_COUNT ,
FAILED_DETAILS ) already exist exactly as they do
today.
# ── Inside the loop over request files in
the selected service ──
# REQUEST_FILE, RESPONSE_FILE, SERVICE,
AUTH_TOKEN_SERVICE, BASE_URL already set.
API_NAME="${TEST_NAME}" # derived from
filename as today (e.g. getUsersApi) # Read API-level fields ONCE
METHOD=$(jq -r '.method' "$REQUEST_FILE")
ENDPOINT=$(jq -r '.endpoint'
"$REQUEST_FILE")
TOKEN_TYPE=$(jq -r '.token_type //
"service"' "$REQUEST_FILE")
# Decide whether this file uses the new
multi-case shape or the old single shape
HAS_CASES=$(jq 'has("cases")'
"$REQUEST_FILE")
# Helper: run ONE case. Args: caseName,
queryParams, body,
# expectedStatus, mode, fieldsJson,
expectedBodyJson
run_one_case() {
 local CASE_NAME="$1"
 local QUERY_PARAMS="$2"
 local BODY="$3"
 local EXPECTED_STATUS="$4"
 local MODE="$5"
 local FIELDS="$6"
 local EXPECTED_BODY="$7"
 local LABEL="${API_NAME}.${CASE_NAME}"
 echo ""
 echo ">> Test: $LABEL"
 # Build full URL
 local FULL_URL
 if [ -n "$QUERY_PARAMS" ]; then
 FULL_URL="${BASE_URL}${ENDPOINT}? ${QUERY_PARAMS}"
 else
 FULL_URL="${BASE_URL}${ENDPOINT}"
 fi
 echo " Method : $METHOD"
 echo " URL : $FULL_URL"
 [ -n "$BODY" ] && echo " Body :
$BODY"
 # Fire request (always uses the service
token in the single-service model)
 local START_TIME END_TIME RESPONSE
CURL_EXIT RESPONSE_TIME
 START_TIME=$(date +%s%3N)
 if [ -n "$BODY" ]; then
 RESPONSE=$(curl -s \
 --max-time "$CURL_TIMEOUT" \
 -w "\n%{http_code}" \
 -X "$METHOD" \
 -H "accept: application/json" \
 -H "Content-Type: application/json" \
 -H "Authorization: Bearer
$AUTH_TOKEN_SERVICE" \
 -d "$BODY" \
 "$FULL_URL")
 else
 RESPONSE=$(curl -s \
 --max-time "$CURL_TIMEOUT" \
 -w "\n%{http_code}" \
 -X "$METHOD" \
 -H "accept: application/json" \
 -H "Authorization: Bearer $AUTH_TOKEN_SERVICE" \
 "$FULL_URL")
 fi
 CURL_EXIT=$?
 END_TIME=$(date +%s%3N)
 RESPONSE_TIME=$((END_TIME - ST

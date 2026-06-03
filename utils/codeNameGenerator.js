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



---+++

    Perfect. I have everything. Let me build it all from scratch now.

---

## Final Folder Structure

```
.
├── .github
│   └── workflows
│       ├── ci.yml          ← existing, untouched
│       └── nrt.yml         ← new
├── .mvn
├── src
│   ├── main
│   │   ├── java
│   │   │   └── com/example/gh_actions_demo1/
│   │   │       └── GhActionsDemo1Application.java
│   │   └── resources
│   │       └── application.properties
│   └── test
│       ├── java
│       │   └── com/example/gh_actions_demo1/
│       │       └── nrt/
│       │           └── NrtEngine.java
│       └── resources
│           └── nrt/
│               └── currencyApi/
│                   ├── request.json
│                   └── expected-response.json
├── pom.xml
└── mvnw / mvnw.cmd
```

Everything else — `UserService`, `UserIT`, `UserController`, `User.java` — removed. They were only for the RBAC demo. Clean slate.

---

## File 1 — `pom.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         https://maven.apache.org/xsd/maven-4.0.0.xsd">

    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.2.5</version>
        <relativePath/>
    </parent>

    <groupId>com.example</groupId>
    <artifactId>gh-actions-demo1</artifactId>
    <version>0.0.1-SNAPSHOT</version>

    <properties>
        <java.version>17</java.version>
    </properties>

    <dependencies>

        <!-- Spring Web -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>

        <!-- Spring Test -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>

        <!--
            RestAssured
            Used to fire real HTTP requests in tests.
            Cleaner than HttpClient or OkHttp for API testing.
        -->
        <dependency>
            <groupId>io.rest-assured</groupId>
            <artifactId>rest-assured</artifactId>
            <version>5.4.0</version>
            <scope>test</scope>
        </dependency>

        <!--
            JSONAssert
            Used to compare actual vs expected JSON responses.
            Supports STRICT, LENIENT modes out of the box.
        -->
        <dependency>
            <groupId>org.skyscreamer</groupId>
            <artifactId>jsonassert</artifactId>
            <version>1.5.1</version>
            <scope>test</scope>
        </dependency>

    </dependencies>

    <build>
        <plugins>

            <!--
                Surefire — runs unit tests
                NrtEngine.java is picked up here
                because it ends in Test (no, we name
                it differently — see note below)
            -->
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-surefire-plugin</artifactId>
                <configuration>
                    <!--
                        Exclude NrtEngine from normal test runs.
                        NRT should only run when explicitly triggered.
                        Not during every mvn test.
                    -->
                    <excludes>
                        <exclude>**/nrt/**</exclude>
                    </excludes>
                </configuration>
            </plugin>

            <!--
                Failsafe — runs integration tests (*IT.java)
                Not used for NRT but kept for future use
            -->
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-failsafe-plugin</artifactId>
                <configuration>
                    <includes>
                        <include>**/*IT.java</include>
                    </includes>
                </configuration>
                <executions>
                    <execution>
                        <goals>
                            <goal>integration-test</goal>
                            <goal>verify</goal>
                        </goals>
                    </execution>
                </executions>
            </plugin>

            <!-- Spring Boot -->
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>

        </plugins>
    </build>

</project>
```

---

## File 2 — `GhActionsDemo1Application.java`

```java
package com.example.gh_actions_demo1;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

// Main entry point of the Spring Boot application
// NrtEngine does NOT start this — it hits an external hosted API
@SpringBootApplication
public class GhActionsDemo1Application {
    public static void main(String[] args) {
        SpringApplication.run(GhActionsDemo1Application.class, args);
    }
}
```

---

## File 3 — `NrtEngine.java`

```java
package com.example.gh_actions_demo1.nrt;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.restassured.RestAssured;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import org.junit.jupiter.api.Test;
import org.skyscreamer.jsonassert.JSONAssert;
import org.skyscreamer.jsonassert.JSONCompareMode;
import org.springframework.boot.test.context.SpringBootTest;

import java.io.File;
import java.util.Iterator;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/*
 * ═══════════════════════════════════════════════════════
 * NrtEngine — Non Regression Test Engine
 * ═══════════════════════════════════════════════════════
 *
 * WHAT IT DOES:
 * Fires a real HTTP request to a hosted API and compares
 * the actual response against a stored expected response.
 * If anything changed — status code, fields, values —
 * the test fails and tells you exactly what regressed.
 *
 * HOW TO RUN LOCALLY:
 *   export AUTH_TOKEN=your_bearer_token_from_swagger
 *   export BASE_URL=https://your-uat-server.com
 *   mvn test -Dtest=NrtEngine -Dsurefire.failIfNoSpecifiedTests=false
 *
 * HOW IT RUNS IN CI:
 *   GitHub Actions triggers nrt.yml manually.
 *   You paste the token and base URL as inputs.
 *   They get passed as env variables to this test.
 *
 * FILE STRUCTURE:
 *   src/test/resources/nrt/
 *     currencyApi/
 *       request.json           ← what to send
 *       expected-response.json ← what to expect back
 *
 * VALIDATION MODES (set in expected-response.json):
 *   STRICT   → every field must match exactly
 *   LENIENT  → expected fields must match, extras in actual = OK
 *   IGNORE   → remove listed fields, compare rest leniently
 *   CONTAINS → only check the listed fields, ignore everything else
 * ═══════════════════════════════════════════════════════
 */

// @SpringBootTest is needed to use JUnit in a Spring project
// We are NOT starting our own server here —
// we are hitting a real external hosted API
@SpringBootTest
public class NrtEngine {

    private final ObjectMapper mapper = new ObjectMapper();

    // Base path where all NRT flow folders live
    private final String NRT_BASE = "src/test/resources/nrt/";

    @Test
    void run_currencyApi_nrt() throws Exception {

        // ── STEP 1: READ ENV VARIABLES ───────────────────────────────
        //
        // AUTH_TOKEN → Bearer token copied from Swagger
        // BASE_URL   → The hosted API server URL
        //
        // These are injected by GitHub Actions as env variables.
        // Locally you set them with:
        //   export AUTH_TOKEN=eyJ...
        //   export BASE_URL=https://uat.server.com
        //
        String authToken = System.getenv("AUTH_TOKEN");
        String baseUrl   = System.getenv("BASE_URL");

        // Edge case: env variables not set at all
        // Fail immediately with a clear message instead of
        // a confusing NullPointerException 10 lines later
        assertNotNull(authToken,
            "\n[NRT ERROR] AUTH_TOKEN environment variable is not set.\n" +
            "Locally: export AUTH_TOKEN=your_token\n" +
            "CI: pass it as workflow input.");

        assertNotNull(baseUrl,
            "\n[NRT ERROR] BASE_URL environment variable is not set.\n" +
            "Locally: export BASE_URL=https://your-server.com\n" +
            "CI: pass it as workflow input.");

        // Edge case: env variables set but empty strings
        assertFalse(authToken.isBlank(),
            "[NRT ERROR] AUTH_TOKEN is set but empty.");
        assertFalse(baseUrl.isBlank(),
            "[NRT ERROR] BASE_URL is set but empty.");

        // ── STEP 2: LOAD JSON FILES ──────────────────────────────────
        //
        // Each API flow lives in its own folder.
        // Two files per flow — request.json and expected-response.json
        //
        String flowPath = NRT_BASE + "currencyApi/";

        File requestFile  = new File(flowPath + "request.json");
        File expectedFile = new File(flowPath + "expected-response.json");

        // Edge case: someone forgot to create the files
        assertTrue(requestFile.exists(),
            "[NRT ERROR] Missing file: " + flowPath + "request.json");
        assertTrue(expectedFile.exists(),
            "[NRT ERROR] Missing file: " +
            flowPath + "expected-response.json");

        // Parse files into JsonNode so we can navigate fields
        JsonNode requestJson  = mapper.readTree(requestFile);
        JsonNode expectedJson = mapper.readTree(expectedFile);

        // Edge case: files exist but are empty or malformed JSON
        assertNotNull(requestJson,
            "[NRT ERROR] request.json is empty or invalid JSON.");
        assertNotNull(expectedJson,
            "[NRT ERROR] expected-response.json is empty or invalid JSON.");

        // ── STEP 3: PARSE REQUEST DETAILS ───────────────────────────
        //
        // Pull method and endpoint from request.json
        // method   → GET, POST, PUT, DELETE, PATCH
        // endpoint → /currency
        // fullUrl  → https://uat.server.com/currency
        //
        // Edge case: method or endpoint missing in request.json
        assertTrue(requestJson.has("method"),
            "[NRT ERROR] 'method' field missing in request.json");
        assertTrue(requestJson.has("endpoint"),
            "[NRT ERROR] 'endpoint' field missing in request.json");

        String method   = requestJson.get("method").asText().toUpperCase();
        String endpoint = requestJson.get("endpoint").asText();
        String fullUrl  = baseUrl + endpoint;

        System.out.println("\n========== NRT ENGINE START ==========");
        System.out.println(">> Flow    : currencyApi");
        System.out.println(">> Method  : " + method);
        System.out.println(">> URL     : " + fullUrl);
        System.out.println(">> Base URL: " + baseUrl);

        // ── STEP 4: BUILD HTTP REQUEST ───────────────────────────────
        //
        // RestAssured builds the HTTP request.
        // We always attach the Bearer token from env variable.
        //
        RequestSpecification spec = RestAssured.given()
            .contentType("application/json")
            // Bearer token from Swagger, passed via env variable
            .header("Authorization", "Bearer " + authToken);

        // Add query params if present in request.json
        // e.g. ?sortBy=ccyCode&sortOrder=asc
        if (requestJson.has("query_params") &&
            !requestJson.get("query_params").isEmpty()) {

            Iterator<Map.Entry<String, JsonNode>> params =
                requestJson.get("query_params").fields();

            while (params.hasNext()) {
                Map.Entry<String, JsonNode> param = params.next();
                spec = spec.queryParam(
                    param.getKey(),
                    param.getValue().asText()
                );
                System.out.println(">> Param   : " +
                    param.getKey() + "=" + param.getValue().asText());
            }
        }

        // Add request body if present and not empty
        // GET requests will have empty {} — we skip those
        JsonNode requestBody = requestJson.get("request_body");
        if (requestBody != null && !requestBody.isEmpty()) {
            spec = spec.body(requestBody.toString());
            System.out.println(">> Body    : " + requestBody);
        }

        // ── STEP 5: FIRE THE REQUEST ─────────────────────────────────
        //
        // Switch on HTTP method and fire accordingly.
        // Edge case: unsupported method in request.json
        //
        Response response = switch (method) {
            case "GET"    -> spec.get(fullUrl);
            case "POST"   -> spec.post(fullUrl);
            case "PUT"    -> spec.put(fullUrl);
            case "DELETE" -> spec.delete(fullUrl);
            case "PATCH"  -> spec.patch(fullUrl);
            default -> throw new IllegalArgumentException(
                "[NRT ERROR] Unsupported HTTP method in request.json: "
                + method +
                ". Allowed: GET, POST, PUT, DELETE, PATCH");
        };

        System.out.println(">> Status  : " + response.getStatusCode());
        System.out.println(">> Response: " + response.getBody().asString());

        // ── STEP 6: CHECK STATUS CODE ────────────────────────────────
        //
        // Check the HTTP status code first before touching the body.
        // If status is wrong, no point comparing the body.
        // Edge case: expectedStatus missing from expected-response.json
        //
        assertTrue(expectedJson.has("expectedStatus"),
            "[NRT ERROR] 'expectedStatus' missing in " +
            "expected-response.json");

        int expectedStatus = expectedJson.get("expectedStatus").asInt();

        assertEquals(
            expectedStatus,
            response.getStatusCode(),
            // On failure, print the full body so you know WHY it failed
            "\n[NRT FAIL] Status code mismatch." +
            "\nExpected : " + expectedStatus +
            "\nActual   : " + response.getStatusCode() +
            "\nBody     : " + response.getBody().asString()
        );

        // ── STEP 7: PARSE ACTUAL RESPONSE ────────────────────────────
        //
        // Parse the response body as JSON.
        // Edge case: API returns HTML error page or plain text
        // instead of JSON — we catch and fail clearly.
        //
        String responseBody = response.getBody().asString();
        ObjectNode actual;

        try {
            actual = (ObjectNode) mapper.readTree(responseBody);
        } catch (Exception e) {
            fail("\n[NRT FAIL] Response is not valid JSON.\n" +
                 "Raw response was:\n" + responseBody);
            return; // compiler needs this — fail() throws but
                    // compiler doesn't know that
        }

        // ── STEP 8: APPLY VALIDATION MODE ───────────────────────────
        //
        // Read validation config from expected-response.json
        // Edge cases: validation block missing, mode missing,
        // unknown mode value
        //
        assertTrue(expectedJson.has("validation"),
            "[NRT ERROR] 'validation' block missing in " +
            "expected-response.json");
        assertTrue(expectedJson.has("expectedResponse"),
            "[NRT ERROR] 'expectedResponse' block missing in " +
            "expected-response.json");

        JsonNode validation   = expectedJson.get("validation");

        assertTrue(validation.has("mode"),
            "[NRT ERROR] 'mode' missing inside 'validation' block");

        String mode           = validation.get("mode").asText().toUpperCase();
        JsonNode fields       = validation.get("fields");
        JsonNode expectedBody = expectedJson.get("expectedResponse");

        System.out.println(">> Mode    : " + mode);

        switch (mode) {

            case "STRICT" -> {
                // Every field must match exactly.
                // Extra fields in actual = FAIL.
                // Field order matters.
                // Use when API contract is fully locked down.
                System.out.println(">> Comparing with STRICT mode");
                JSONAssert.assertEquals(
                    expectedBody.toString(),
                    actual.toString(),
                    JSONCompareMode.STRICT
                );
            }

            case "LENIENT" -> {
                // All fields in expected must match.
                // Extra fields in actual = OK.
                // Field order doesn't matter.
                // Use when API returns extra metadata you don't care about.
                System.out.println(">> Comparing with LENIENT mode");
                JSONAssert.assertEquals(
                    expectedBody.toString(),
                    actual.toString(),
                    JSONCompareMode.LENIENT
                );
            }

            case "IGNORE" -> {
                // Remove listed dynamic fields from actual before comparing.
                // Use for fields like timestamp, id that change every call.
                // Compare the rest leniently.
                System.out.println(">> Comparing with IGNORE mode");

                if (fields != null && !fields.isEmpty()) {
                    fields.forEach(f -> {
                        String fieldName = f.asText();
                        actual.remove(fieldName);
                        System.out.println(
                            ">> Ignoring field: " + fieldName);
                    });
                }

                JSONAssert.assertEquals(
                    expectedBody.toString(),
                    actual.toString(),
                    JSONCompareMode.LENIENT
                );
            }

            case "CONTAINS" -> {
                // Only check the specific fields listed in "fields".
                // Everything else in actual is completely ignored.
                // Use when you only care about a few key fields.
                System.out.println(">> Comparing with CONTAINS mode");

                // Edge case: fields array missing or empty for CONTAINS
                assertNotNull(fields,
                    "[NRT ERROR] CONTAINS mode requires 'fields' array " +
                    "in validation block.");
                assertFalse(fields.isEmpty(),
                    "[NRT ERROR] CONTAINS mode 'fields' array is empty. " +
                    "Add the fields you want to check.");

                ObjectNode filteredActual   = mapper.createObjectNode();
                ObjectNode filteredExpected = mapper.createObjectNode();

                fields.forEach(f -> {
                    String fieldName = f.asText();

                    if (actual.has(fieldName)) {
                        filteredActual.set(fieldName,
                            actual.get(fieldName));
                    } else {
                        System.out.println(
                            ">> WARNING: field '" + fieldName +
                            "' listed in CONTAINS but not found in " +
                            "actual response");
                    }

                    if (expectedBody.has(fieldName)) {
                        filteredExpected.set(fieldName,
                            expectedBody.get(fieldName));
                    }
                });

                JSONAssert.assertEquals(
                    filteredExpected.toString(),
                    filteredActual.toString(),
                    JSONCompareMode.LENIENT
                );
            }

            default -> throw new IllegalArgumentException(
                "[NRT ERROR] Unknown validation mode: '" + mode + "'.\n" +
                "Allowed modes: STRICT, LENIENT, IGNORE, CONTAINS"
            );
        }

        System.out.println(">> RESULT  : PASSED");
        System.out.println("========== NRT ENGINE END ============\n");
    }
}
```

---

## File 4 — `request.json`

```json
{
  "_comment": "NRT request definition for currency API. Fill in actual values.",

  "method": "GET",

  "endpoint": "/currency",

  "query_params": {
    "sortBy": "ccyCode",
    "sortOrder": "asc"
  },

  "request_body": {}
}
```

---

## File 5 — `expected-response.json`

```json
{
  "_comment": "Expected response contract for currency API.",

  "expectedStatus": 200,

  "validation": {
    "mode": "IGNORE",
    "fields": ["timestamp"]
  },

  "expectedResponse": {
  }
}
```

Fill `expectedResponse` by copying the actual response from Swagger once.

---

## File 6 — `nrt.yml`

```yaml
name: NRT - Non Regression Tests

# ── TRIGGER ───────────────────────────────────────────────
# Manually triggered only.
# You provide the Bearer token and target environment URL
# at trigger time. Token is copied from Swagger.
on:
  workflow_dispatch:
    inputs:

      auth_token:
        description: 'Bearer token (copy from Swagger)'
        required: true
        type: string

      base_url:
        description: 'Target environment base URL'
        required: true
        type: choice
        options:
          - https://uat.your-server.com
          - https://preprod.your-server.com

# ── JOBS ──────────────────────────────────────────────────
jobs:
  nrt:
    runs-on: [self-hosted, linux]

    steps:

      # Step 1: Checkout the code
      - name: Checkout Code
        uses: actions/checkout@v4

      # Step 2: Setup Java and Maven
      # Same action as ci.yml — keeps it consistent
      - name: Setup Java and Maven
        uses: SGithubActions/setup-java-maven@stable
        with:
          jdk_version: 17.0.8+7

      # Step 3: RBAC Check
      # Same pattern as ci.yml — only vivek-narayana can run
      # Change this to the actual NRT owner when needed
      - name: RBAC Check
        run: |
          if [[ "${{ github.actor }}" != "vivek-narayana" ]]; then
            echo "User not authorized to trigger NRT pipeline"
            exit 1
          fi

      # Step 4: Run NRT Engine
      # Passes token and URL as env variables
      # NrtEngine reads them via System.getenv()
      # -Dsurefire.failIfNoSpecifiedTests=false prevents
      # Maven from failing when only NrtEngine is specified
      - name: Run NRT Engine
        env:
          AUTH_TOKEN: ${{ inputs.auth_token }}
          BASE_URL: ${{ inputs.base_url }}
        run: |
          mvn test \
            -Dtest=NrtEngine \
            -Dsurefire.failIfNoSpecifiedTests=false

      # Step 5: Publish Test Report
      # Runs even if tests fail — so you always see the report
      # Shows exactly which flow failed and what the diff was
      - name: Publish NRT Report
        if: always()
        uses: dorny/test-reporter@v1
        with:
          name: NRT Results
          path: target/surefire-reports/*.xml
          reporter: java-junit
```

---

## What Changed vs Your Existing `ci.yml`

```
ci.yml          → completely untouched
nrt.yml         → new separate workflow
RBAC            → same pattern, same check
runner          → same self-hosted linux
java setup      → same SGithubActions action
```

---

## All Edge Cases Handled

```
AUTH_TOKEN not set          → clear error message
AUTH_TOKEN empty string     → clear error message
BASE_URL not set            → clear error message
BASE_URL empty string       → clear error message
request.json missing        → clear error message
expected-response.json miss → clear error message
Files empty/invalid JSON    → clear error message
method field missing        → clear error message
endpoint field missing      → clear error message
expectedStatus missing      → clear error message
validation block missing    → clear error message
mode field missing          → clear error message
unknown mode value          → clear error message
response not JSON           → prints raw response
CONTAINS with no fields     → clear error message
field in CONTAINS not found → warning printed
wrong status code           → prints actual body
```

---

## How To Run

**Locally:**
```bash
export AUTH_TOKEN=eyJ...your_token
export BASE_URL=https://uat.your-server.com
mvn test -Dtest=NrtEngine -Dsurefire.failIfNoSpecifiedTests=false
```

**GitHub Actions:**
```
1. Go to repo → Actions tab
2. Click "NRT - Non Regression Tests"
3. Click "Run workflow"
4. Paste token from Swagger
5. Select environment URL
6. Click Run
```

---

Now send me what's in `application.properties` and the actual currency API URL + response from Swagger, and I'll fill in the JSON files completely.

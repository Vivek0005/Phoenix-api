Hi all,

Thanks everyone for joining yesterday's demo of the NRT framework. Sharing the minutes of meeting below covering what was discussed and the action items going forward.

What Was Discussed:

1. Walked through the README and gave an overview of how the framework works — stores expected request/response pairs as JSON, fires the actual API call, and compares it to catch regressions.

2. Covered the four validation modes built to handle any RESTful API — EXACT, CONTAINS, IGNORE, and EXISTS.

3. Demonstrated Role Based Access Control — only authorized users (myself, Amisha, Amber) can trigger the workflow; unauthorized attempts fail immediately.

4. Walked through triggering the workflow — branch, environment, service selection, and the token inputs required.

5. Showed a live run and explained the summary report — environment details, user metadata, test results table, failures, and final pass/fail count. Also touched on the detailed logs available for developers.

6. Noted that this automates what is currently a manual MS Word based record-keeping process, and emphasized the framework is lightweight and dependency-free (pure shell, curl, jq), making it reusable across teams.

To-Do Items:

1. Same API, different test cases (query params and body combinations) — cover all probable inputs and possible combinations for a given API rather than a single test case, look at how to optimize this, and review whether the existing four validation modes sufficiently cover these scenarios.

2. SGConnect for HOM — look into SGConnect token validation for the HOM environment.

3. Analyze performance — add response time tracking as part of performance analysis for each API test.

4. Environment comparison — evaluate whether comparing responses across two environments (e.g. dev vs uat) is necessary before building it out.

5. Token generation — look into how token generation can be automated, to reduce the manual Swagger copy-paste step currently required before each run.

Will start working on these and share progress updates as we go. Please let me know if I've missed anything from the discussion.

Thanks,
Vivek

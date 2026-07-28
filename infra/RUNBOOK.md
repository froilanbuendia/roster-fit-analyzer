# Roster Fit Analyzer — Alerting Runbook

Alarms notify the `RosterFitAnalyzerAlerts` SNS topic, which emails
`froilangbuendia@gmail.com`. Alarm/resource names below have a CDK-generated
hash suffix in the console (e.g. `RosterFitAnalyzerStack-RosterApiErrorsAlarm...`) —
search by the prefix.

**Dashboard:** [`RosterFitAnalyzer`](https://us-west-2.console.aws.amazon.com/cloudwatch/home?region=us-west-2#dashboards:name=RosterFitAnalyzer)
— alarm status, Lambda errors/duration, API Gateway 4xx/5xx/latency, DynamoDB
throttling, and a live "recent errors" log query, all on one screen. Start
every incident here before going to individual metrics.

---

## 1. Lambda error rate spike

**Symptom:** `RosterApiErrorsAlarm` fires — `RosterApiFunction` `Errors` ≥ 1
over 5 minutes.

**Diagnostic:** Dashboard → "Recent Lambda errors" widget, or run directly
against the `RosterApiLogGroup` log group in Logs Insights:

```
fields @timestamp, message, routeKey, error.name, error.message
| filter level = "ERROR"
| sort @timestamp desc
| limit 50
```

Group by error type to spot a pattern vs. a one-off:

```
fields error.name
| filter level = "ERROR"
| stats count(*) as errors by error.name
| sort errors desc
```

**Likely root causes, in order of likelihood:**

- **DynamoDB throttling** — `error.name` is `ProvisionedThroughputExceededException`
  / `ThrottlingException`. Cross-check the dashboard's DynamoDB widget or
  scenario 2 below — if that's also elevated, the root cause is there, not
  the Lambda.
- **Malformed `pathParameters`** — e.g. `/players/{id}` hit with an `id` that
  breaks a downstream call. The `logger.info("Handling request", ...)` line
  immediately before the error entry has the exact `pathParameters` that
  triggered it.
- **Downstream data gap from the ingestion pipeline** — `collect_roster_data.py`
  → `upload_to_dynamodb.py` writes `PLAYER`/`BASELINE`/`ROSTER` items; if the
  last run was partial or wrote malformed data (missing `stat_rows`, bad
  `Decimal` values), reads can throw where the handler assumes a shape
  that isn't there. `error.message` showing a `TypeError`/`undefined`
  pattern (rather than an AWS SDK exception name) is the signature of this
  cause.

**Remediation:**

- Throttling → follow scenario 2.
- Malformed input → this is a 4xx-shaped problem masquerading as a 500; add
  a guard clause for the offending route rather than treating it as an
  incident.
- Data gap → re-run the ingestion pipeline (`collect_roster_data.py` from
  `data-processing/`, then `upload_to_dynamodb.py` from the same directory)
  to backfill/overwrite the bad items.

**Escalation:** Solo project, no on-call — there's no one to page. If it's
not resolvable in one sitting, message yourself (Slack "saved for later" /
todo) with the alarm timestamp and the `error.name` breakdown above, so the
next session starts from the diagnosis instead of re-running these queries.

---

## 2. DynamoDB throttling

**Symptom:** `TableThrottleAlarm` fires — `GetItem`/`Query` `ThrottledRequests`
on the `RosterFitAnalyzer` table ≥ 1 over 5 minutes.

**Diagnostic:** Dashboard → "DynamoDB throttled requests" widget. Cross-reference
against `ConsumedReadCapacityUnits` (table's own Monitor tab in the DynamoDB
console — not currently on the dashboard) at the same timestamp to see if it's
a sustained climb (hot partition / genuine load increase) or a single spike
(more likely a burst from one request pattern, e.g. a client retry loop
hammering `/players`).

**On-demand vs. provisioned check:** the table is `PAY_PER_REQUEST`
(on-demand), which auto-scales — so throttling here almost always means one
of:

- A burst that exceeded on-demand's per-partition burst ceiling — check
  whether a single `PK` value (e.g. one hot `BASELINE#<season>` or
  `ROSTER#<season>` item) is taking a disproportionate share of traffic.
- A sudden traffic spike faster than on-demand can scale (it scales within
  minutes, not instantly) — check the dashboard's API Gateway request count
  around the same timestamp for a legitimate surge vs. a bot/scraper.

**Remediation:**

- The Lambda's DynamoDB calls (`GetCommand`/`QueryCommand` in
  `infra/lambda/roster-api/index.mjs`) already use the AWS SDK v3's built-in
  retry/backoff — no code change needed there.
- Genuine hot-partition pattern (e.g. everyone hitting the same
  `ROSTER#2025-26` item) → consider whether that item's read volume justifies
  in-Lambda caching. Likely overkill at this project's traffic; only worth
  doing if this becomes recurring rather than a one-off.
- Bursty/abusive traffic → check API Gateway access patterns for a single
  client hammering the API; consider throttling at the HTTP API level.

**Escalation:** Same as above — no on-call. Note the timestamp and whether it
was a spike or sustained climb; if sustained, that's the thing to revisit
next session even after the alarm clears.

---

## 3. API Gateway 5xx spike without Lambda errors

**Symptom:** `RosterApi5xxAlarm` fires while `RosterApiErrorsAlarm` stays `OK`.

**What this means:** the Lambda function itself isn't throwing — the 5xx is
coming from the integration layer: a timeout, a Lambda concurrency throttle,
or a malformed response the Lambda returned that API Gateway couldn't proxy.

**Diagnostic:** Dashboard → "Lambda duration (p50 / p99) vs. timeout" widget
(the red annotation line is the configured 10s timeout) and "API Gateway 4xx
/ 5xx" widget, same time window as the alarm.

- Duration graph crossing the timeout line, or `RosterApiDurationAlarm` also
  in/recently in `ALARM` → the 5xx is very likely `Lambda ${resource} timed
  out after N seconds` at the API Gateway level.
- Duration looks normal → check the Lambda's `Throttles` metric (top-left
  dashboard widget) — concurrent invocations exceeding the account/function
  concurrency limit produce a 429 from Lambda that API Gateway surfaces as a
  5xx.
- Neither → confirm every code path in the handler's `switch` actually
  returns via `jsonResponse(...)`; an unhandled path returning `undefined`
  produces a malformed integration response without ever hitting the `catch`
  block (so no `Errors` metric increment and no log line — this is the one
  cause the dashboard can't directly show you).

**Remediation:**

- Timeout → investigate *why* it's slow first (DynamoDB latency? cold start
  plus a cold DynamoDB connection?) before raising `rosterApiTimeout` — a
  longer timeout can mask a regression instead of fixing it.
- Throttling → check whether it's legitimate traffic growth (raise reserved
  concurrency) or a retry storm from a client (fix the client, don't just add
  capacity).
- Malformed response → code review of the specific `routeKey` branch; likely
  a regression from a recent change, so check
  `git log -p -- infra/lambda/roster-api/index.mjs` for anything recent.

**Escalation:** Same as above — no on-call. If the cause is "malformed
response with no error log," that gap is itself worth a follow-up: it means
this failure mode is currently invisible to both alarms and logs.
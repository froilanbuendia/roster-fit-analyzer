# Roster Fit Analyzer — SLOs / SLIs

Defined 2026-07-29, once real signal existed to ground them in: dashboard
history, the alarm thresholds in `roster-fit-analyzer-stack.ts`, and the
first canary results (see [`RUNBOOK.md`](RUNBOOK.md) §4). Baselines below
are pulled directly from CloudWatch, not estimated.

**Caveat that matters more than any number here:** this project gets ~2-3
requests/day (71 Lambda invocations over the trailing 30 days, all almost
certainly manual/dev traffic, not real users). A 0% error rate over 71
requests is not evidence of a <1% error rate — it's just an absence of
failures in a small sample. Treat every target below as provisional until
there's enough volume for the percentage to mean something. Revisit this
doc once traffic looks like real usage rather than testing.

---

## 1. Availability SLO

**Target:** 99.5% of canary checks succeed over a rolling 30 days.

**SLI:** `CloudWatchSynthetics` → `SuccessPercent`, dimension
`CanaryName=roster-fit-availability` (`infra/canary/canary.js`, checks both
`/health` and the CloudFront frontend URL every 5 minutes).

**Error budget:** at 288 runs/day × 30 days ≈ 8,640 runs/month, 99.5% allows
~43 failed runs/month (~3.6 hours of failed-check time, at 5-minute
granularity).

**Current baseline:** canary has been running less than a day — one
datapoint, 100% success. Not enough history to say whether 99.5% is
realistic; it's a starting target, not a validated one. Revisit after ~30
days of real canary data.

**SLI integrity issue found, fixed, and re-validated (2026-07-29 game day,
see [`RUNBOOK.md`](RUNBOOK.md) game day log):** the canary-level
`SuccessPercent` metric stayed at 100% throughout a real, confirmed outage
— `executeHttpStep`'s `continueOnHttpStepFailure` option defaults to `true`,
so a failed step logged an error but didn't fail the run. Every "100%
success" reading before this fix is suspect. Fixed in
`infra/canary/canary.js` (`continueOnHttpStepFailure: false`), deployed,
then re-tested against the same injected failure: the canary run correctly
came back `FAILED`, `SuccessPercent` dropped to `0.0`, and
`CanaryFailedAlarm` fired. This SLI is now trustworthy going forward — prior
history before 2026-07-29 is not.

**Relationship to alerting:** `CanaryFailedAlarm` fires on *any* single
failed 5-minute window (`treatMissingData: BREACHING`) — that's a
page-immediately tripwire, not the same thing as the 30-day SLO. You can
breach the SLO without ever seeing a sustained alarm (many isolated
single-run blips), and you can trip the alarm without threatening the SLO
(one blip eats ~0.03% of the monthly budget). There's currently no
automated *burn-rate* alarm tied to the 30-day window — that's a gap, not
an oversight; add one if/when this budget actually starts getting consumed.

---

## 2. Latency SLO

**Target:** 95% of API requests complete under 2000ms (API Gateway
`Latency`, i.e. end-to-end including the Lambda invocation).

**SLI:** `AWS/ApiGateway` → `Latency`, dimension `ApiId=s0jp2xgzz7`, p95.

**Current baseline (trailing 30 days):** p50 ≈ 900ms–1.3s, p95 ≈ 1.4s,
p99 ≈ 1.4–1.5s. Lambda `Duration` alone is p50 ≈ 800–950ms, p99 ≈ 950ms–1.4s.

**Why 2000ms and not 500ms:** at this traffic volume (~2-3 req/day) almost
every invocation is a cold start — there's no steady warm pool to serve
off of. A 500ms target isn't a target, it's a demand for provisioned
concurrency or a warm-up ping, which is real cost/complexity this project's
traffic doesn't justify yet (`rosterApiTimeout` is already 10s specifically
to give cold-started Lambda + DynamoDB room to breathe — see stack
comments). 2000ms is set just above the observed p99 so the SLO reflects
current architecture rather than an aspiration nothing is working toward.
If p95 latency ever actually matters (e.g. this stops being a personal
dashboard), the fix is provisioned concurrency or a keep-warm schedule, not
loosening the number further.

**Relationship to alerting:** `RosterApiDurationAlarm` alarms on Lambda
`Duration` p99 ≥ 80% of the 10s timeout (8000ms) — that's a
timeout-is-imminent tripwire, an order of magnitude looser than this SLO.
Nothing currently alerts on the 2000ms SLO threshold itself; the dashboard's
"API Gateway latency (avg / p99)" widget is the manual check today.

---

## 3. Error rate SLO

**Target:** <1% of requests return 5xx, over a rolling 30 days.

**SLI:** `AWS/ApiGateway` → `5xx` (sum) ÷ `Count` (sum), dimension
`ApiId=s0jp2xgzz7`.

**Current baseline:** 0 5xx / 71 requests over the trailing 30 days (0%,
sample-size caveat above applies). `RosterApiErrorsAlarm` (Lambda `Errors`
≥ 1) and `RosterApi5xxAlarm` (API Gateway `5xx` ≥ 1) both fire on a single
occurrence within 5 minutes — far stricter than the 1% monthly budget, by
design: at current volume, one 5xx *is* a meaningful fraction of traffic,
so alarming immediately is more useful than waiting for a rate to cross 1%.

**Relationship to alerting:** the existing alarms are a superset of this
SLO in practice — anything that would burn the error budget already pages
you today. No additional alarm needed unless traffic grows enough that
single-occurrence alarms become noisy, at which point the 1% rolling
target is what the alarm should graduate to.

---

## Revisit triggers

- Traffic crosses roughly 10-20x current volume (i.e. looks like real
  usage, not dev traffic) — recompute all three baselines before trusting
  the percentages.
- The latency SLO gets tightened only if there's an actual reason p95
  matters (multi-user, not just yourself) — otherwise 2000ms stays as the
  honest reflection of the current architecture.
- Add a 30-day burn-rate alarm for the availability SLO once there's a full
  month of canary data to set a sane threshold against.
# Roster Fit Analyzer

## What this is

A Lakers roster comparison dashboard — new offseason additions vs.
positional stats from last season, plus roster composition before/after.

## Architecture

- Data: nba_api (Python) → DynamoDB (single table, multi-item: PLAYER/BASELINE/ROSTER)
- Backend: Lambda (single function, routed by path) + API Gateway HTTP API
- Frontend: Next.js static export, S3 + CloudFront (no custom domain)
- IaC: AWS CDK (TypeScript), separate stack from the portfolio project

## Key decisions / gotchas

- Player stats use a hybrid endpoint strategy: PlayerCareerStats for
  new additions (preserves multi-team season splits), LeagueDashPlayerStats
  (Lakers-filtered) for returning/departed players — PlayerCareerStats is
  unreliable for a few high-profile players (LeBron, Luka) regardless of retries.
- collect_roster_data.py is resumable and anchors its output path to
  **file**, not cwd — always run it from data-processing/.
- Season baseline is 2025-26 (the season just completed).
- DynamoDB floats must be loaded with parse_float=Decimal.

## Status

- [x] Data pipeline, DynamoDB, Lambda/API Gateway, S3/CloudFront infra — deployed
- [x] Summary stats + new-addition comparison cards — built
- [ ] Roster composition chart — not started
- [ ] Frontend deploy to S3 + CI/CD

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

An NBA Lakers roster-fit analyzer. It pulls per-player stats from the NBA.com API, computes positional baselines from the prior Lakers roster, and loads everything into a single DynamoDB table so a frontend can render "new addition vs. Lakers positional average" comparison cards.

## Commands

### Python (data-processing)

```bash
source venv/bin/activate
cd data-processing

# Collect stats → roster_data.json (resumable; re-run if it fails mid-way)
python collect_roster_data.py

# Upload roster_data.json → DynamoDB
python upload_to_dynamodb.py

# Quick API sanity check
python ../explore.py
```

### Infrastructure (CDK — TypeScript)

```bash
cd infra
npm install
npm run build          # tsc
npm run test           # jest
npx cdk synth          # emit CloudFormation template
npx cdk diff           # compare deployed vs. local
npx cdk deploy         # deploy to AWS
```

CDK reads `CDK_ACCOUNT` and `CDK_REGION` from `infra/.env` (via dotenv in `bin/infra.ts`).

## Architecture

**Data flow**: `collect_roster_data.py` → `roster_data.json` → `upload_to_dynamodb.py` → DynamoDB

### DynamoDB single-table design (`RosterFitAnalyzer`, `us-west-2`)

| Entity | PK | SK | `entity_type` |
|--------|----|----|---------------|
| Player profile + stats | `PLAYER#{player_id}` | `PROFILE` | `PLAYER` |
| Positional average (prior Lakers roster) | `BASELINE#{season}` | `POSITION#{pos}` | `BASELINE` |
| Full roster snapshot | `ROSTER#{season}` | `SUMMARY` | `ROSTER` |

GSI `EntityTypeIndex` partitions on `entity_type` with `PK` as sort key — used to fetch all items of a given type without a full scan.

### `collect_roster_data.py` internals

Three player categories drive different stat-collection paths:

- **`NEW_ADDITIONS`** — played for a different team last season; stats fetched via `PlayerCareerStats` (per-player, preserving mid-season trade splits by excluding the `TOT` row).
- **`RETURNING_CORE` / `DEPARTED`** — were Lakers last season; looked up directly from the already-fetched `LeagueDashPlayerStats` Lakers subset to avoid flaky per-player API calls for high-profile players.

`collect_roster_data.py` is resumable: it writes `roster_data.json` incrementally and skips players that already have `stat_rows` on re-run.

`normalize_position` collapses hybrid labels like `F-G` to the primary position (`F`) so positional grouping doesn't fragment into single-player buckets.

### `upload_to_dynamodb.py` internals

Floats in `roster_data.json` are parsed as `Decimal` on load (`json.load(..., parse_float=Decimal)`) because boto3's DynamoDB serializer rejects native Python floats.

# Lakers Roster Fit Analyzer

Compares the 2026-27 Lakers roster additions against positional averages from last season. Built to answer: do the new pieces fill the gaps the departures left?

**Live:** https://d1iwvnizbo7jos.cloudfront.net

## What it shows

- **Summary stats** — roster turnover count, average age delta, net PPG added/lost
- **Player comparison cards** — each new addition's prior-team stats vs. the Lakers positional average for their position
- **Roster composition** — position breakdown and age-sorted player list before and after the offseason

## Architecture

```
nba_api (Python)
    → roster_data.json
    → DynamoDB (single table: PLAYER / BASELINE / ROSTER items)
    → Lambda (path-routed) + API Gateway HTTP API
    → Next.js static export → S3 + CloudFront
```

Infrastructure is managed with AWS CDK (TypeScript) in `infra/`. Frontend is Next.js in `frontend/`. Data collection and upload scripts are in `data-processing/`.

## Local development

```bash
# Frontend
cd frontend
npm install
npm run dev          # http://localhost:3000
# Requires NEXT_PUBLIC_API_URL in frontend/.env.local
```

## Data pipeline

```bash
source venv/bin/activate
cd data-processing

python collect_roster_data.py   # → roster_data.json (resumable)
python upload_to_dynamodb.py    # → DynamoDB
```

Requires AWS credentials configured locally. Update `SEASONS_TO_CHECK` and the player lists in `collect_roster_data.py` each offseason.

## Infrastructure

```bash
cd infra
npm install
npx cdk diff      # preview changes
npx cdk deploy    # deploy to AWS
```

Requires `CDK_ACCOUNT` and `CDK_REGION` in `infra/.env`.

## Deployment

Frontend deploys automatically via GitHub Actions on push to `main` (paths under `frontend/`). Requires `DEPLOY_ROLE_ARN` set as a repository variable in GitHub.
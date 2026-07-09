"""
Uploads roster_data.json into the RosterFitAnalyzer DynamoDB table,
transforming the flat JSON produced by collect_roster_data.py into
the multi-item schema: PLAYER, BASELINE, and ROSTER items.

Requires: pip install boto3
Requires AWS credentials configured locally (aws configure), same as
any other AWS CLI/SDK usage.
"""

import boto3
import json
from decimal import Decimal

TABLE_NAME = "RosterFitAnalyzer"
REGION = "us-west-2"  # match wherever your table is deployed


def load_roster_data(path: str = "roster_data.json") -> dict:
    # DynamoDB doesn't support native Python floats — parse_float=Decimal
    # converts every float in the JSON to a Decimal on load, which boto3's
    # DynamoDB serializer can actually handle.
    with open(path) as f:
        return json.load(f, parse_float=Decimal)


def put_player_items(table, players: dict):
    for name, data in players.items():
        if not data.get("stat_rows"):
            print(f"  Skipping {name} — no stat rows to store")
            continue

        table.put_item(Item={
            "PK": f"PLAYER#{data['player_id']}",
            "SK": "PROFILE",
            "entity_type": "PLAYER",
            "name": name,
            "category": data["category"],
            "season_used": data["season_used"],
            "bio": data.get("bio"),
            "stat_rows": data["stat_rows"],
        })
        print(f"  Uploaded player: {name}")


def put_baseline_items(table, baseline: dict, season: str):
    for position, stats in baseline.items():
        table.put_item(Item={
            "PK": f"BASELINE#{season}",
            "SK": f"POSITION#{position}",
            "entity_type": "BASELINE",
            "position": position,
            **stats,
        })
        print(f"  Uploaded baseline: {position} ({season})")


def put_roster_items(table, roster_composition: dict):
    for label, roster in roster_composition.items():
        # label is "before" or "after"; roster has its own "season" field
        if not roster:
            continue
        season = roster.get("season", label)
        table.put_item(Item={
            "PK": f"ROSTER#{season}",
            "SK": "SUMMARY",
            "entity_type": "ROSTER",
            "label": label,  # "before" or "after", for easy frontend reference
            "roster_size": roster.get("roster_size"),
            "avg_age": roster.get("avg_age"),
            "players": roster.get("players", []),
        })
        print(f"  Uploaded roster composition: {label} ({season})")


def main():
    dynamodb = boto3.resource("dynamodb", region_name=REGION)
    table = dynamodb.Table(TABLE_NAME)

    data = load_roster_data()

    print("Uploading player items...")
    put_player_items(table, data.get("players", {}))

    print("\nUploading positional baseline items...")
    put_baseline_items(table, data.get("lakers_positional_baseline", {}), data.get("baseline_season"))

    print("\nUploading roster composition items...")
    put_roster_items(table, data.get("roster_composition", {}))

    print("\nDone.")


if __name__ == "__main__":
    main()
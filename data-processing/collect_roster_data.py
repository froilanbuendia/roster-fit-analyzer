"""
Collects historical season stats for the current Lakers roster,
tagged by team, to support prior-team-vs-Lakers positional comparisons.

Pulls three things:
  1. Individual stats for new additions + notable departures
     (LeagueDashPlayerStats, one request per season, all players)
  2. Bio info (position, age, years of experience) for those same
     players (CommonPlayerInfo, one request per player)
  3. The full prior-season Lakers roster, so we have real positional
     averages to compare new players against (CommonTeamRoster +
     LeagueDashPlayerStats)
"""

from nba_api.stats.static import players
from nba_api.stats.endpoints import (
    leaguedashplayerstats,
    playercareerstats,
    commonplayerinfo,
    commonteamroster,
)
import pandas as pd
import time
import json
import os

# Always resolve relative to this script's own location, not whatever
# directory the shell happens to be in when it's run — avoids ending
# up with duplicate roster_data.json files scattered across the repo.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "roster_data.json")

LAKERS_TEAM_ID = 1610612747

NEW_ADDITIONS = [
    "Walker Kessler",
    "Sandro Mamukelashvili",
    "Quentin Grimes",
    "Collin Sexton",
    "Jaden Hardy",
    "Kevon Looney",
    "Ziaire Williams",
    "Matisse Thybulle"
]

RETURNING_CORE = [
    "Luka Doncic",
    "Austin Reaves",
]

DEPARTED = [
    "LeBron James",
    "Deandre Ayton",
    "Marcus Smart",
    "Luke Kennard",
    "Jaxson Hayes",
    "Rui Hachimura",
]

ALL_PLAYERS = NEW_ADDITIONS + RETURNING_CORE + DEPARTED

SEASONS_TO_CHECK = ["2025-26"]
PRIOR_ROSTER_SEASON = "2025-26"  # the season just completed — both new
                                  # additions' prior-team stats and departed
                                  # players' final Lakers stats come from here


def with_retries(fn, max_retries: int = 3, label: str = ""):
    """Generic retry wrapper with backoff for flaky NBA.com responses."""
    for attempt in range(1, max_retries + 1):
        try:
            df = fn()
            if not df.empty:
                return df
        except Exception as e:
            print(f"    [{label}] attempt {attempt} failed: {e}")
        print(f"    [{label}] empty/failed response, retrying...")
        time.sleep(5 * attempt)
    return pd.DataFrame()


def build_player_id_lookup(names: list[str]) -> dict[str, int]:
    lookup = {}
    for name in names:
        matches = players.find_players_by_full_name(name)
        if not matches:
            print(f"  WARNING: no ID match found for '{name}'")
            continue
        lookup[name] = matches[0]["id"]
    return lookup


def fetch_season_league_wide(season: str) -> pd.DataFrame:
    return with_retries(
        lambda: leaguedashplayerstats.LeagueDashPlayerStats(
            season=season,
            season_type_all_star="Regular Season",
            per_mode_detailed="Totals",
            timeout=30,
        ).get_data_frames()[0],
        label=f"stats {season}",
    )


def calculate_age(birthdate_str: str) -> int | None:
    """CommonPlayerInfo returns BIRTHDATE, not AGE directly — compute it."""
    if not birthdate_str:
        return None
    from datetime import datetime
    birthdate = datetime.strptime(birthdate_str[:10], "%Y-%m-%d")
    today = datetime.now()
    age = today.year - birthdate.year
    if (today.month, today.day) < (birthdate.month, birthdate.day):
        age -= 1
    return age


def fetch_player_bio_clean(player_id: int) -> dict | None:
    df = with_retries(
        lambda: commonplayerinfo.CommonPlayerInfo(
            player_id=player_id, timeout=30
        ).get_data_frames()[0],
        label=f"bio {player_id}",
    )
    if df.empty:
        return None
    row = df.iloc[0]
    return {
        "position": row["POSITION"],
        "height": row["HEIGHT"],
        "weight": row["WEIGHT"] if pd.notna(row.get("WEIGHT")) else None,
        "years_exp": int(row["SEASON_EXP"]),
        "age": calculate_age(row["BIRTHDATE"]),
        "country": row.get("COUNTRY"),
        "draft_year": row.get("DRAFT_YEAR"),
        "draft_round": row.get("DRAFT_ROUND"),
        "draft_number": row.get("DRAFT_NUMBER"),
    }


def fetch_prior_lakers_roster(season: str) -> pd.DataFrame:
    """Full roster (names, position, age, experience) for a given season."""
    return with_retries(
        lambda: commonteamroster.CommonTeamRoster(
            team_id=LAKERS_TEAM_ID, season=season, timeout=30
        ).get_data_frames()[0],
        label=f"roster {season}",
    )


def fetch_player_season_splits(player_id: int, season: str) -> list[dict] | None:
    """
    Per-player career stats, filtered to one season, preserving each
    team the player suited up for that season individually (not
    collapsed into one row the way LeagueDashPlayerStats returns it).
    This correctly handles a player traded mid-season, e.g. showing
    both his Charlotte and Chicago stat lines separately.
    """
    df = with_retries(
        lambda: playercareerstats.PlayerCareerStats(
            player_id=player_id, timeout=30
        ).get_data_frames()[0],
        label=f"career splits {player_id}",
    )
    if df.empty:
        return None

    season_rows = df[df["SEASON_ID"] == season]
    # exclude the combined 'TOT' row — we want the individual team lines
    team_rows = season_rows[season_rows["TEAM_ABBREVIATION"] != "TOT"]

    if team_rows.empty:
        return None

    return [stat_row_to_dict(r) for _, r in team_rows.iterrows()]


def stat_row_to_dict(row) -> dict:
    gp = row["GP"] if row["GP"] else 1

    def safe_pct(col):
        return round(row[col], 3) if pd.notna(row.get(col)) else None

    def safe_per_game(col):
        return round(row[col] / gp, 1) if pd.notna(row.get(col)) else None

    return {
        "team": row["TEAM_ABBREVIATION"],
        "games_played": int(row["GP"]),
        "games_started": int(row["GS"]) if pd.notna(row.get("GS")) else None,
        "min_per_game": safe_per_game("MIN"),
        "pts_per_game": safe_per_game("PTS"),
        "reb_per_game": safe_per_game("REB"),
        "oreb_per_game": safe_per_game("OREB"),
        "dreb_per_game": safe_per_game("DREB"),
        "ast_per_game": safe_per_game("AST"),
        "stl_per_game": safe_per_game("STL"),
        "blk_per_game": safe_per_game("BLK"),
        "tov_per_game": safe_per_game("TOV"),
        "pf_per_game": safe_per_game("PF"),
        "fg_pct": safe_pct("FG_PCT"),
        "fg3_pct": safe_pct("FG3_PCT"),
        "ft_pct": safe_pct("FT_PCT"),
        "plus_minus_per_game": safe_per_game("PLUS_MINUS"),
    }


def collect_named_player_data(
    existing: dict | None = None, lakers_stats_df: pd.DataFrame | None = None
) -> dict:
    """
    Individual stats + bio for the new additions / returning core /
    departed lists. Resumable: pass in a previously saved 'players'
    dict and already-successful players are skipped.

    RETURNING_CORE and DEPARTED players were on the Lakers last
    season, so their stats already exist in lakers_stats_df (pulled
    once for the positional baseline) — we look them up there
    directly instead of hitting PlayerCareerStats per-player, which
    has proven unreliable specifically for a few high-profile players
    (LeBron, Luka) regardless of retries/delays.

    Only NEW_ADDITIONS genuinely need the per-player split call,
    since they played for a different team last season.
    """
    id_lookup = build_player_id_lookup(ALL_PLAYERS)
    output = dict(existing) if existing else {}

    for name, player_id in id_lookup.items():
        if name in output and output[name].get("stat_rows"):
            print(f"Skipping (already have data): {name}")
            continue

        print(f"Processing: {name}")
        category = (
            "new_addition" if name in NEW_ADDITIONS
            else "returning_core" if name in RETURNING_CORE
            else "departed"
        )

        stats_entry = None
        used_season = None

        if category == "new_addition":
            for season in SEASONS_TO_CHECK:
                rows = fetch_player_season_splits(player_id, season)
                if rows:
                    stats_entry = rows
                    used_season = season
                    break
            time.sleep(2)
        else:
            # Was a Lakers player last season — look up directly in
            # the already-fetched Lakers team stats instead of
            # PlayerCareerStats.
            if lakers_stats_df is not None and not lakers_stats_df.empty:
                player_rows = lakers_stats_df[
                    lakers_stats_df["PLAYER_ID"] == player_id
                ]
                if not player_rows.empty:
                    stats_entry = [
                        stat_row_to_dict(r) for _, r in player_rows.iterrows()
                    ]
                    used_season = PRIOR_ROSTER_SEASON

        bio = fetch_player_bio_clean(player_id)
        time.sleep(3)

        if stats_entry is None:
            print(f"  WARNING: no stats found for '{name}' in checked seasons")

        output[name] = {
            "player_id": int(player_id),
            "category": category,
            "season_used": used_season,
            "stat_rows": stats_entry,
            "bio": bio,
        }

    return output


def normalize_position(position: str) -> str:
    """
    CommonTeamRoster labels hybrid players like 'F-G' or 'C-F'. Group
    by primary (first-listed) position so 'F-G' folds into 'F' rather
    than forming its own single-player bucket.
    """
    if not position:
        return "UNKNOWN"
    return position.split("-")[0]


def collect_current_roster_composition(season: str) -> dict:
    """
    Full current-season roster (every player, including rookies and
    depth players not individually tracked elsewhere in this script).
    Used for team-wide composition stats like average age — NOT for
    the individual comparison cards, which stay scoped to the named
    players list.

    Rookies have no prior-season stats (nba_api's team roster still
    lists them, but LeagueDashPlayerStats has nothing for a player who
    hasn't played an NBA game yet), so age/experience come straight
    from the roster listing itself, independent of stats availability.
    """
    print(f"\nFetching full current roster for {season}...")
    roster_df = fetch_prior_lakers_roster(season)  # same endpoint, any season

    if roster_df.empty:
        print("  WARNING: could not fetch current roster")
        return {}

    players_out = []
    for _, row in roster_df.iterrows():
        players_out.append({
            "name": row["PLAYER"],
            "position": normalize_position(row["POSITION"]),
            "age": int(row["AGE"]) if pd.notna(row.get("AGE")) else None,
            "years_exp": row["EXP"] if pd.notna(row.get("EXP")) else None,
            "is_rookie": row.get("EXP") == "R",
        })

    ages = [p["age"] for p in players_out if p["age"] is not None]

    return {
        "season": season,
        "roster_size": len(players_out),
        "avg_age": round(sum(ages) / len(ages), 1) if ages else None,
        "players": players_out,
    }


def collect_prior_lakers_positional_baseline(lakers_stats_df: pd.DataFrame) -> dict:
    """
    Full prior-season Lakers roster with stats, grouped by position,
    to serve as the 'Lakers positional average' comparison baseline.
    """
    print(f"\nFetching full Lakers roster for {PRIOR_ROSTER_SEASON}...")
    roster_df = fetch_prior_lakers_roster(PRIOR_ROSTER_SEASON)

    if roster_df.empty or lakers_stats_df.empty:
        print("  WARNING: could not build positional baseline, missing data")
        return {}

    merged = roster_df.merge(
        lakers_stats_df, on="PLAYER_ID", how="inner"
    )
    merged["PRIMARY_POSITION"] = merged["POSITION"].apply(normalize_position)

    baseline = {}
    for position, group in merged.groupby("PRIMARY_POSITION"):
        gp_sum = group["GP"].replace(0, 1)
        baseline[position] = {
            "player_count": len(group),
            "avg_min_per_game": round((group["MIN"] / gp_sum).mean(), 1),
            "avg_pts_per_game": round((group["PTS"] / gp_sum).mean(), 1),
            "avg_reb_per_game": round((group["REB"] / gp_sum).mean(), 1),
            "avg_oreb_per_game": round((group["OREB"] / gp_sum).mean(), 1),
            "avg_dreb_per_game": round((group["DREB"] / gp_sum).mean(), 1),
            "avg_ast_per_game": round((group["AST"] / gp_sum).mean(), 1),
            "avg_stl_per_game": round((group["STL"] / gp_sum).mean(), 1),
            "avg_blk_per_game": round((group["BLK"] / gp_sum).mean(), 1),
            "avg_tov_per_game": round((group["TOV"] / gp_sum).mean(), 1),
            "avg_fg_pct": round(group["FG_PCT"].mean(), 3),
            "avg_fg3_pct": round(group["FG3_PCT"].mean(), 3),
            "avg_ft_pct": round(group["FT_PCT"].mean(), 3),
            "avg_plus_minus_per_game": round((group["PLUS_MINUS"] / gp_sum).mean(), 1),
        }

    return baseline


if __name__ == "__main__":
    existing_data = {}
    if os.path.exists(OUTPUT_PATH):
        with open(OUTPUT_PATH) as f:
            prior = json.load(f)
            existing_data = prior.get("players", {})
            if existing_data:
                print(f"Found existing roster_data.json with {len(existing_data)} players, resuming...\n")

    print(f"Fetching Lakers team stats for {PRIOR_ROSTER_SEASON}...")
    all_stats_df = fetch_season_league_wide(PRIOR_ROSTER_SEASON)
    lakers_stats_df = (
        all_stats_df[all_stats_df["TEAM_ID"] == LAKERS_TEAM_ID]
        if not all_stats_df.empty else pd.DataFrame()
    )

    named_players = collect_named_player_data(
        existing=existing_data, lakers_stats_df=lakers_stats_df
    )
    positional_baseline = collect_prior_lakers_positional_baseline(lakers_stats_df)
    current_roster = collect_current_roster_composition("2026-27")
    prior_roster = collect_current_roster_composition(PRIOR_ROSTER_SEASON)

    output = {
        "players": named_players,
        "lakers_positional_baseline": positional_baseline,
        "baseline_season": PRIOR_ROSTER_SEASON,
        "roster_composition": {
            "before": prior_roster,
            "after": current_roster,
        },
    }

    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nDone. Collected {len(named_players)} players + positional baseline + roster composition -> {OUTPUT_PATH}")
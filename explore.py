from nba_api.stats.static import players
from nba_api.stats.endpoints import playercareerstats

matches = players.find_players_by_full_name("LeBron James")
player_id = matches[0]["id"]

career = playercareerstats.PlayerCareerStats(player_id=player_id, timeout=30)
df = career.get_data_frames()[0]
print("Rows returned:", len(df))
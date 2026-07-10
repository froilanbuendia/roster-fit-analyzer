const API_URL = process.env.NEXT_PUBLIC_API_URL;

if (!API_URL && typeof window !== "undefined") {
  console.error("NEXT_PUBLIC_API_URL is not set");
}

export interface StatRow {
  team: string;
  games_played: number;
  games_started: number | null;
  min_per_game: number | null;
  pts_per_game: number | null;
  reb_per_game: number | null;
  oreb_per_game: number | null;
  dreb_per_game: number | null;
  ast_per_game: number | null;
  stl_per_game: number | null;
  blk_per_game: number | null;
  tov_per_game: number | null;
  pf_per_game: number | null;
  fg_pct: number | null;
  fg3_pct: number | null;
  ft_pct: number | null;
  plus_minus_per_game: number | null;
}

export interface PlayerBio {
  position: string;
  height: string;
  weight: string | null;
  years_exp: number;
  age: number | null;
  country: string | null;
  draft_year: string | null;
  draft_round: string | null;
  draft_number: string | null;
}

export interface Player {
  PK: string;
  SK: string;
  entity_type: "PLAYER";
  name: string;
  category: "new_addition" | "returning_core" | "departed";
  season_used: string;
  bio: PlayerBio | null;
  stat_rows: StatRow[];
}

export interface PositionBaseline {
  PK: string;
  SK: string;
  entity_type: "BASELINE";
  position: string;
  player_count: number;
  avg_min_per_game: number;
  avg_pts_per_game: number;
  avg_reb_per_game: number;
  avg_oreb_per_game: number;
  avg_dreb_per_game: number;
  avg_ast_per_game: number;
  avg_stl_per_game: number;
  avg_blk_per_game: number;
  avg_tov_per_game: number;
  avg_fg_pct: number;
  avg_fg3_pct: number;
  avg_ft_pct: number;
  avg_plus_minus_per_game: number;
}

export interface RosterPlayer {
  name: string;
  position: string;
  age: number | null;
  years_exp: string | number | null;
  is_rookie: boolean;
}

export interface RosterComposition {
  PK: string;
  SK: string;
  entity_type: "ROSTER";
  label: "before" | "after";
  roster_size: number;
  avg_age: number | null;
  players: RosterPlayer[];
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    throw new Error(`Request to ${path} failed: ${res.status}`);
  }
  return res.json();
}

export const getAllPlayers = () => fetchJson<Player[]>("/players");

export const getPlayer = (id: string | number) =>
  fetchJson<Player>(`/players/${id}`);

export const getBaseline = (season: string) =>
  fetchJson<PositionBaseline[]>(`/baseline/${season}`);

export const getRosterComposition = (season: string) =>
  fetchJson<RosterComposition>(`/roster/${season}`);

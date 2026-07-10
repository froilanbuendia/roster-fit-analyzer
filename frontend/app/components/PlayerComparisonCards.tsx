import type { Player, PositionBaseline, StatRow } from "../lib/api";

const POSITION_ABBREV: Record<string, string> = {
  Guard: "G",
  Forward: "F",
  Center: "C",
};

function normalizeBioPosition(position: string): string {
  const primary = position.split("-")[0].trim();
  return POSITION_ABBREV[primary] ?? primary;
}

interface AggStats {
  games_played: number;
  teams: string[];
  pts_per_game: number | null;
  reb_per_game: number | null;
  ast_per_game: number | null;
  stl_per_game: number | null;
  blk_per_game: number | null;
  fg_pct: number | null;
  fg3_pct: number | null;
}

function aggregateStatRows(rows: StatRow[]): AggStats {
  const totalGames = rows.reduce((s, r) => s + r.games_played, 0);
  const denom = totalGames || 1;

  function wpg(key: keyof StatRow): number | null {
    if (rows.every((r) => r[key] == null)) return null;
    const sum = rows.reduce((s, r) => s + ((r[key] as number | null) ?? 0) * r.games_played, 0);
    return Math.round((sum / denom) * 10) / 10;
  }

  function wpct(key: keyof StatRow): number | null {
    if (rows.every((r) => r[key] == null)) return null;
    const sum = rows.reduce((s, r) => s + ((r[key] as number | null) ?? 0) * r.games_played, 0);
    return Math.round((sum / denom) * 1000) / 1000;
  }

  return {
    games_played: totalGames,
    teams: rows.map((r) => r.team),
    pts_per_game: wpg("pts_per_game"),
    reb_per_game: wpg("reb_per_game"),
    ast_per_game: wpg("ast_per_game"),
    stl_per_game: wpg("stl_per_game"),
    blk_per_game: wpg("blk_per_game"),
    fg_pct: wpct("fg_pct"),
    fg3_pct: wpct("fg3_pct"),
  };
}

const STAT_DEFS: {
  label: string;
  playerKey: keyof AggStats;
  baselineKey: keyof PositionBaseline;
  fmt: (v: number) => string;
}[] = [
  { label: "PTS", playerKey: "pts_per_game", baselineKey: "avg_pts_per_game", fmt: (v) => v.toFixed(1) },
  { label: "REB", playerKey: "reb_per_game", baselineKey: "avg_reb_per_game", fmt: (v) => v.toFixed(1) },
  { label: "AST", playerKey: "ast_per_game", baselineKey: "avg_ast_per_game", fmt: (v) => v.toFixed(1) },
  { label: "STL", playerKey: "stl_per_game", baselineKey: "avg_stl_per_game", fmt: (v) => v.toFixed(1) },
  { label: "BLK", playerKey: "blk_per_game", baselineKey: "avg_blk_per_game", fmt: (v) => v.toFixed(1) },
  { label: "FG%", playerKey: "fg_pct", baselineKey: "avg_fg_pct", fmt: (v) => (v * 100).toFixed(1) + "%" },
  { label: "3P%", playerKey: "fg3_pct", baselineKey: "avg_fg3_pct", fmt: (v) => (v * 100).toFixed(1) + "%" },
];

interface Props {
  players: Player[];
  baseline: PositionBaseline[];
}

export function PlayerComparisonCards({ players, baseline }: Props) {
  const newAdditions = players.filter(
    (p) => p.category === "new_addition" && p.stat_rows?.length,
  );
  const baselineByPos = Object.fromEntries(baseline.map((b) => [b.position, b]));

  if (newAdditions.length === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="text-xs font-medium text-neutral-400 mb-3 uppercase tracking-wide">
        New additions vs. Lakers positional avg
      </h2>
      <div className="space-y-3">
        {newAdditions.map((player) => {
          const agg = aggregateStatRows(player.stat_rows);
          const normPos = player.bio ? normalizeBioPosition(player.bio.position) : null;
          const bl = normPos ? baselineByPos[normPos] ?? null : null;
          return (
            <PlayerCard key={player.PK} player={player} agg={agg} baseline={bl} normPos={normPos} />
          );
        })}
      </div>
    </div>
  );
}

function PlayerCard({
  player,
  agg,
  baseline,
  normPos,
}: {
  player: Player;
  agg: AggStats;
  baseline: PositionBaseline | null;
  normPos: string | null;
}) {
  const bio = player.bio;
  const teamsLabel = agg.teams.length > 1 ? agg.teams.join(" → ") : agg.teams[0];

  return (
    <div className="bg-neutral-100 dark:bg-neutral-900 rounded-lg p-4">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <span className="font-medium">{player.name}</span>
          {bio && (
            <span className="text-sm text-neutral-500 ml-2">
              {normPos} · {bio.age}y · {bio.height}
            </span>
          )}
        </div>
        <span className="text-xs text-neutral-400">
          {teamsLabel} · {agg.games_played} gp
        </span>
      </div>

      <div className="grid grid-cols-[4rem_1fr_1fr] text-xs text-neutral-400 mb-1">
        <span />
        <span className="text-center">Prior team</span>
        <span className="text-center">LAL {normPos ?? ""} avg</span>
      </div>

      {STAT_DEFS.map(({ label, playerKey, baselineKey, fmt }) => {
        const pVal = agg[playerKey] as number | null;
        const bVal = baseline ? (baseline[baselineKey] as number) : null;
        const valueColor =
          pVal != null && bVal != null
            ? pVal >= bVal
              ? "text-green-600"
              : "text-red-500"
            : "";

        return (
          <div key={label} className="grid grid-cols-[4rem_1fr_1fr] text-sm py-0.5">
            <span className="text-xs text-neutral-400">{label}</span>
            <span className={`text-center font-medium ${valueColor}`}>
              {pVal != null ? fmt(pVal) : "—"}
            </span>
            <span className="text-center text-neutral-500">
              {bVal != null ? fmt(bVal) : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
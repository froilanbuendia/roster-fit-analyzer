import type { RosterComposition, RosterPlayer } from "../lib/api";

const POSITIONS = ["G", "F", "C"] as const;

function posCounts(players: RosterPlayer[]) {
  const counts: Record<string, number> = { G: 0, F: 0, C: 0 };
  for (const p of players) {
    if (p.position in counts) counts[p.position]++;
  }
  return counts;
}

interface Props {
  rosterBefore: RosterComposition | null;
  rosterAfter: RosterComposition | null;
}

export function RosterCompositionChart({ rosterBefore, rosterAfter }: Props) {
  if (!rosterBefore || !rosterAfter) return null;

  const ageDelta =
    rosterAfter.avg_age != null && rosterBefore.avg_age != null
      ? rosterAfter.avg_age - rosterBefore.avg_age
      : null;

  return (
    <div className="mb-8">
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="text-xs font-medium text-neutral-400 uppercase tracking-wide">
          Roster composition
        </h2>
        {ageDelta != null && (
          <span className={`text-xs ${ageDelta < 0 ? "text-green-600" : "text-neutral-400"}`}>
            avg age {ageDelta > 0 ? "+" : ""}
            {ageDelta.toFixed(1)} yrs
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <RosterColumn roster={rosterBefore} label="Before" />
        <RosterColumn roster={rosterAfter} label="After" />
      </div>
    </div>
  );
}

function RosterColumn({ roster, label }: { roster: RosterComposition; label: string }) {
  const counts = posCounts(roster.players);
  const maxCount = Math.max(...POSITIONS.map((p) => counts[p]));
  const sorted = [...roster.players].sort((a, b) => (b.age ?? 0) - (a.age ?? 0));

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-neutral-400">{roster.PK.split("#")[1]}</span>
      </div>

      <div className="bg-neutral-100 dark:bg-neutral-900 rounded-lg p-3 mb-3">
        <p className="text-xs text-neutral-400 mb-2.5">
          avg age {roster.avg_age?.toFixed(1)} · {roster.roster_size} players
        </p>
        {POSITIONS.map((pos) => (
          <div key={pos} className="flex items-center gap-2 mb-1.5 last:mb-0">
            <span className="text-xs text-neutral-400 w-4 shrink-0">{pos}</span>
            <div className="flex-1 bg-neutral-200 dark:bg-neutral-800 rounded-full h-1.5">
              <div
                className="bg-neutral-500 dark:bg-neutral-400 h-1.5 rounded-full transition-all"
                style={{ width: `${(counts[pos] / maxCount) * 100}%` }}
              />
            </div>
            <span className="text-xs text-neutral-500 w-3 text-right shrink-0">
              {counts[pos]}
            </span>
          </div>
        ))}
      </div>

      <div className="space-y-1">
        {sorted.map((p) => (
          <div key={p.name} className="flex items-center justify-between">
            <span className="text-sm text-neutral-700 dark:text-neutral-300 truncate mr-2">
              {p.name}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-neutral-400">{p.position}</span>
              <span className="text-xs text-neutral-400 w-5 text-right">
                {p.age ?? "—"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
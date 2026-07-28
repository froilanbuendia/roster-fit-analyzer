import type { Player, RosterComposition } from "../lib/api";

interface Props {
  players: Player[];
  rosterBefore: RosterComposition | null;
  rosterAfter: RosterComposition | null;
}

function computeNetPtsAdded(players: Player[]): number {
  const additions = players.filter((p) => p.category === "new_addition");
  const departed = players.filter((p) => p.category === "departed");

  const sumPts = (list: Player[]) =>
    list.reduce((total, p) => {
      // a traded player has multiple stat_rows (per team) — sum them
      // for a rough "total production" figure
      const playerTotal = p.stat_rows.reduce(
        (sum, row) => sum + (row.pts_per_game ?? 0),
        0,
      );
      return total + playerTotal;
    }, 0);

  return sumPts(additions) - sumPts(departed);
}

export function SummaryStats({ players, rosterBefore, rosterAfter }: Props) {
  const turnoverCount = players.filter(
    (p) => p.category === "new_addition",
  ).length;
  const netPts = computeNetPtsAdded(players);
  const avgAgeAfter = rosterAfter?.avg_age;
  const avgAgeDelta =
    rosterAfter?.avg_age != null && rosterBefore?.avg_age != null
      ? rosterAfter.avg_age - rosterBefore.avg_age
      : null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
      <StatCard
        label="Roster turnover"
        value={`${turnoverCount}`}
        suffix="players"
      />
      <StatCard
        label="Avg age"
        value={avgAgeAfter != null ? avgAgeAfter.toFixed(1) : "—"}
        suffix={
          avgAgeDelta != null
            ? `${avgAgeDelta > 0 ? "+" : ""}${avgAgeDelta.toFixed(1)}`
            : undefined
        }
        suffixColor={
          avgAgeDelta != null && avgAgeDelta < 0
            ? "text-green-600"
            : "text-neutral-500"
        }
      />
      <StatCard
        label="Roster size"
        value={`${rosterAfter?.roster_size ?? "—"}`}
      />
      <StatCard
        label="Net PPG added"
        value={`${netPts > 0 ? "+" : ""}${netPts.toFixed(1)}`}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix,
  suffixColor = "text-neutral-500",
}: {
  label: string;
  value: string;
  suffix?: string;
  suffixColor?: string;
}) {
  return (
    <div className="bg-neutral-100 dark:bg-neutral-900 rounded-lg p-3">
      <p className="text-xs text-neutral-500 mb-1">{label}</p>
      <p className="text-xl font-medium text-lakers-gold">
        {value}
        {suffix && (
          <span className={`text-xs font-normal ml-1 ${suffixColor}`}>
            {suffix}
          </span>
        )}
      </p>
    </div>
  );
}

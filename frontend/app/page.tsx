"use client";

import { useDashboardData } from "./lib/useDashboardData";
import { SummaryStats } from "./components/SummaryStats";
import { PlayerComparisonCards } from "./components/PlayerComparisonCards";
import { RosterCompositionChart } from "./components/RosterCompositionChart";

export default function Home() {
  const { data, loading, error } = useDashboardData();

  if (loading) return <div className="p-8">Loading...</div>;
  if (error) return <div className="p-8">Error: {error}</div>;
  if (!data) return null;

  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="mb-5">
        <h1 className="text-lg font-medium">Lakers roster fit analyzer</h1>
        <p className="text-sm text-neutral-500">
          How the new roster compares to last season
        </p>
      </div>

      <SummaryStats
        players={data.players}
        rosterBefore={data.rosterBefore}
        rosterAfter={data.rosterAfter}
      />

      <PlayerComparisonCards players={data.players} baseline={data.baseline} />

      <RosterCompositionChart rosterBefore={data.rosterBefore} rosterAfter={data.rosterAfter} />
    </main>
  );
}

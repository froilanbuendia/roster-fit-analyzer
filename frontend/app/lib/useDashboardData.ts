"use client";

import { useEffect, useState } from "react";
import {
  getAllPlayers,
  getBaseline,
  getRosterComposition,
  type Player,
  type PositionBaseline,
  type RosterComposition,
} from "./api";

const SEASON = "2025-26"; // the completed season used as the comparison baseline

interface DashboardData {
  players: Player[];
  baseline: PositionBaseline[];
  rosterBefore: RosterComposition | null;
  rosterAfter: RosterComposition | null;
}

export function useDashboardData() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadAll() {
      try {
        const [players, baseline, rosterBefore, rosterAfter] =
          await Promise.all([
            getAllPlayers(),
            getBaseline(SEASON),
            getRosterComposition(SEASON),
            getRosterComposition("2026-27"),
          ]);
        setData({ players, baseline, rosterBefore, rosterAfter });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    loadAll();
  }, []);

  return { data, loading, error };
}

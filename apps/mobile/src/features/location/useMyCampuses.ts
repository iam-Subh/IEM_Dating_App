import { useCallback, useEffect, useState } from "react";
import { api } from "../../services/api";

export type Campus = { id: string; code: string; name: string; mapped: boolean };

/**
 * The campuses of the institution this person verified with (LOCATION_SPEC.md
 * 8.1). Pickers show only these, so nobody can choose another institution's
 * campus - and IEM's Gurukul and UEM Jaipur's Gurukul can never be confused.
 */
export function useMyCampuses() {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/profile/campuses");
      const data = response.data.data as { campuses: Campus[]; campusId: string | null };
      setCampuses(data.campuses);
      setCurrent(data.campuses.find((campus) => campus.id === data.campusId)?.name ?? null);
    } catch {
      setError("Could not load your campuses. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { campuses, current, loading, error, reload: load };
}

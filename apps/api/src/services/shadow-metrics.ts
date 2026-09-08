import { RankingCandidate } from './ranking-policy';

export function shadowMetrics(control: string[], treatment: string[], candidates: RankingCandidate[]) {
  const top = Math.min(20, control.length, treatment.length);
  const treatmentRanks = new Map(treatment.map((id, index) => [id, index]));
  const known = candidates.filter((p): p is RankingCandidate & { score: number } => p.score !== null);
  const scores = known.map(p => p.score).sort((a,b) => a-b);
  const placement = (ids: string[]) => {
    const incoming = new Set(candidates.filter(p => p.incomingLike).map(p => p.id));
    const positions = ids.flatMap((id, index) => incoming.has(id) ? [index + 1] : []);
    return { top20: positions.filter(x => x <= 20).length, count: positions.length,
      meanPosition: positions.length ? positions.reduce((a,b) => a+b,0) / positions.length : null };
  };
  return {
    top20Overlap: top ? control.slice(0,top).filter(id => treatment.slice(0,top).includes(id)).length / top : null,
    meanAbsRankShift: control.length ? control.reduce((sum,id,index) => sum + Math.abs(index - (treatmentRanks.get(id) ?? index)),0) / control.length : null,
    evidenceCoverage: candidates.length ? known.length / candidates.length : null,
    incomingPlacement: { control: placement(control), treatment: placement(treatment) },
    scoreDistribution: { count: scores.length, min: scores[0] ?? null, max: scores[scores.length - 1] ?? null,
      median: scores.length ? scores[Math.floor(scores.length / 2)] : null },
    top20Evidence: { control: control.slice(0,20).filter(id => known.some(p => p.id === id)).length,
      treatment: treatment.slice(0,20).filter(id => known.some(p => p.id === id)).length },
  };
}

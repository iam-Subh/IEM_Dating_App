import { normalizeInterests } from "@iem-dating/shared/interest-catalog";
import {
  estimateReciprocity,
  InterestSignals,
  similarSignals,
} from "./reciprocity.service";
export type LabeledSignals = {
  signals: InterestSignals | null;
  liked: boolean;
};
// Input is oldest first. Only earlier decisions may train the predictor for each target.
export function evaluateHistory(history: LabeledSignals[]) {
  history = history.map(item => {
    const s = item.signals;
    return { ...item, signals: s && typeof s.seeking === 'string' && Array.isArray(s.interests)
      && s.interests.every(x => typeof x === 'string')
      ? { seeking: s.seeking.trim().toLowerCase(), interests: normalizeInterests(s.interests).map(x=>x.trim().toLowerCase()) } : null };
  });
  let evaluated = 0,
    predicted = 0,
    brier = 0,
    baselineBrier = 0,
    logLoss = 0;
  for (let i = 50; i < history.length; i++) {
    const training = history
      .slice(Math.max(0, i - 200), i)
      .filter((x) => x.signals !== null);
    const target = history[i];
    if (!target.signals) continue;
    evaluated++;
    const near = training.filter((x) =>
      similarSignals(x.signals!, target.signals!),
    );
    const estimate = estimateReciprocity(
      training.length,
      training.filter((x) => x.liked).length,
      near.length,
      near.filter((x) => x.liked).length,
    );
    if (!estimate) continue;
    const y = Number(target.liked),
      p = estimate.probability;
    predicted++;
    brier += (p - y) ** 2;
    baselineBrier += (estimate.baseline - y) ** 2;
    logLoss -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
  }
  return {
    evaluated,
    predicted,
    brierSum: brier,
    baselineBrierSum: baselineBrier,
    logLossSum: logLoss,
  };
}

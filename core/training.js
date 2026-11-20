// Training arithmetic. Only confirmed (actually logged) sets count toward volume and PRs.

/** @typedef {{ reps: number, kg: number, confirmed: boolean, rir?: number, note?: string }} WorkoutSet  rir = reps in reserve, the user's own rating */
/** @typedef {{ date: string, exerciseId: string, sets: WorkoutSet[] }} ExerciseLog */

/**
 * Estimated one-rep max (Epley). An ESTIMATE — always label it as such in the UI.
 * Returns null outside 1–12 reps, where the formula is unreliable.
 */
export function estimated1RM(kg, reps) {
  if (!(kg > 0) || !Number.isInteger(reps) || reps < 1 || reps > 12) return null;
  return reps === 1 ? kg : kg * (1 + reps / 30);
}

/** Total kg lifted (reps × kg) over confirmed sets. */
export function volume(sets) {
  return sets.filter((s) => s.confirmed).reduce((acc, s) => acc + s.reps * s.kg, 0);
}

/**
 * Walks logs in date order and reports each time a confirmed set beat the lifter's
 * previous best weight for that exercise at the same or higher reps ("rep PR") —
 * the first ever log of an exercise sets a baseline and is not reported as a PR.
 * @param {ExerciseLog[]} logs
 * @returns {{ date: string, exerciseId: string, kg: number, reps: number, previousKg: number }[]}
 */
export function detectPRs(logs) {
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  /** @type {Map<string, { kg: number, reps: number }[]>} */
  const history = new Map();
  const prs = [];
  for (const log of sorted) {
    const past = history.get(log.exerciseId) ?? [];
    const today = [];
    for (const set of log.sets) {
      if (!set.confirmed || !(set.kg > 0) || !(set.reps >= 1)) continue;
      // Best previous weight achieved for at least this many reps.
      const comparable = past.filter((p) => p.reps >= set.reps).map((p) => p.kg);
      if (past.length > 0) {
        const previousKg = comparable.length ? Math.max(...comparable) : 0;
        const beatenToday = today.some((t) => t.reps >= set.reps && t.kg >= set.kg);
        if (set.kg > previousKg && !beatenToday) {
          prs.push({ date: log.date, exerciseId: log.exerciseId, kg: set.kg, reps: set.reps, previousKg });
        }
      }
      today.push({ kg: set.kg, reps: set.reps });
    }
    history.set(log.exerciseId, past.concat(today));
  }
  return prs;
}

/** Best confirmed set per exercise by estimated 1RM (falls back to weight). */
export function bestSets(logs) {
  const best = new Map();
  for (const log of logs) {
    for (const set of log.sets) {
      if (!set.confirmed) continue;
      const score = estimated1RM(set.kg, set.reps) ?? set.kg;
      const cur = best.get(log.exerciseId);
      if (!cur || score > cur.score) best.set(log.exerciseId, { ...set, date: log.date, score });
    }
  }
  return best;
}

/**
 * One programme day against what was actually logged on a date. Only confirmed sets count;
 * a planned set is never evidence that it was performed.
 * @param {{ exercises: { exerciseId: string, sets: number, reps: number }[] }} day
 * @param {ExerciseLog[]} logsForDate
 */
export function dayProgress(day, logsForDate) {
  return day.exercises.map((p) => {
    const log = logsForDate.find((l) => l.exerciseId === p.exerciseId);
    const loggedSets = log ? log.sets.filter((s) => s.confirmed).length : 0;
    return { exerciseId: p.exerciseId, plannedSets: p.sets, plannedReps: p.reps, loggedSets, complete: loggedSets >= p.sets };
  });
}

/** The latest confirmed set of an exercise (by date, then order logged), or null. Used to prefill the form. */
export function lastSet(logs, exerciseId) {
  const own = logs.filter((l) => l.exerciseId === exerciseId && l.sets.some((s) => s.confirmed))
    .sort((a, b) => a.date.localeCompare(b.date));
  const log = own.at(-1);
  if (!log) return null;
  const set = log.sets.filter((s) => s.confirmed).at(-1);
  return { date: log.date, kg: set.kg, reps: set.reps };
}

/**
 * One line per training day for an exercise, oldest first: the heaviest confirmed set, the best
 * estimated 1RM (an estimate, null when no set is within 1–12 reps), volume and number of sets.
 * @param {ExerciseLog[]} logs
 */
export function exerciseHistory(logs, exerciseId) {
  const byDate = new Map();
  for (const log of logs) {
    if (log.exerciseId !== exerciseId) continue;
    const sets = log.sets.filter((s) => s.confirmed);
    if (sets.length === 0) continue;
    byDate.set(log.date, (byDate.get(log.date) ?? []).concat(sets));
  }
  return [...byDate].sort((a, b) => a[0].localeCompare(b[0])).map(([date, sets]) => {
    const top = sets.reduce((best, s) => (s.kg > best.kg || (s.kg === best.kg && s.reps > best.reps) ? s : best));
    const estimates = sets.map((s) => estimated1RM(s.kg, s.reps)).filter((x) => x != null);
    return { date, topKg: top.kg, topReps: top.reps, est1RM: estimates.length ? Math.max(...estimates) : null, volume: volume(sets), sets: sets.length };
  });
}

/**
 * A SUGGESTION for the next session of an exercise, worked out from the latest logged day only.
 * It is arithmetic on the user's own log, not training advice, and the UI must say so.
 *
 * Rule: look at the sets done at the heaviest weight that day. If every one of them reached the
 * target reps, suggest the next weight step at the same reps — unless the last of them was logged
 * with 0 reps in reserve, in which case the same weight is suggested again. If a set fell short,
 * the same weight is suggested again. The step is 2.5 kg, or 1 kg below 20 kg.
 * @param {ExerciseLog[]} logs
 * @param {string} exerciseId
 * @param {number} [plannedReps] target reps from the programme; without it, the reps of the last top set
 * @returns {{ kg: number, reps: number, reason: 'allReps' | 'noReserve' | 'missedReps', from: { date: string, kg: number, reps: number[] } } | null}
 */
export function suggestNext(logs, exerciseId, plannedReps) {
  const days = logs.filter((l) => l.exerciseId === exerciseId && l.sets.some((s) => s.confirmed)).sort((a, b) => a.date.localeCompare(b.date));
  if (days.length === 0) return null;
  const date = days.at(-1).date;
  const sets = days.filter((l) => l.date === date).flatMap((l) => l.sets.filter((s) => s.confirmed));
  const kg = Math.max(...sets.map((s) => s.kg));
  const top = sets.filter((s) => s.kg === kg);
  const reps = Number.isInteger(plannedReps) && plannedReps >= 1 ? plannedReps : top.at(-1).reps;
  const from = { date, kg, reps: top.map((s) => s.reps) };
  if (top.some((s) => s.reps < reps)) return { kg, reps, reason: 'missedReps', from };
  if (top.at(-1).rir === 0) return { kg, reps, reason: 'noReserve', from };
  return { kg: kg + (kg < 20 ? 1 : 2.5), reps, reason: 'allReps', from };
}

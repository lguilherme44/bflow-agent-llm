/**
 * Utilities for ranking and combining scores from different sources.
 */

export interface ScoredItem<T> {
  item: T;
  score: number;
}

export class RankingUtils {
  /**
   * Combines multiple ranked lists using Reciprocal Rank Fusion (RRF).
   * RRF score = sum( 1 / (k + rank) )
   */
  static rrf<T>(rankedLists: Array<Array<T>>, k = 60): Array<ScoredItem<T>> {
    const scores = new Map<T, number>();
    
    for (const list of rankedLists) {
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        const rank = i + 1;
        const currentScore = scores.get(item) ?? 0;
        scores.set(item, currentScore + (1.0 / (k + rank)));
      }
    }
    
    return Array.from(scores.entries())
      .map(([item, score]) => ({ item, score }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Normalizes scores to a [0, 1] range.
   */
  static normalize(scores: number[]): number[] {
    if (scores.length === 0) return [];
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    if (max === min) return scores.map(() => 1.0);
    return scores.map((s) => (s - min) / (max - min));
  }
}

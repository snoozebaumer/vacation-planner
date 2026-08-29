const K_FACTOR = 32;

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function applyMatchResult(
  winnerRating: number,
  loserRating: number
): { winnerRating: number; loserRating: number } {
  const expectedWinner = expectedScore(winnerRating, loserRating);
  const expectedLoser = expectedScore(loserRating, winnerRating);

  return {
    winnerRating: winnerRating + K_FACTOR * (1 - expectedWinner),
    loserRating: loserRating + K_FACTOR * (0 - expectedLoser),
  };
}

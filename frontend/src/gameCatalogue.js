export function mergeGameCatalogue(serverGames, localGames) {
  const serverGameIds = new Set(serverGames.map((game) => game.id));
  const localPlatforms = localGames.filter(
    (game) => !game.playable && !serverGameIds.has(game.id),
  );
  return [...serverGames, ...localPlatforms];
}

import assert from "node:assert/strict";
import test from "node:test";
import { mergeGameCatalogue } from "../src/gameCatalogue.js";

test("keeps local platform cards when the server game list is stale", () => {
  const serverGames = [{ id: "chess", name: "Chess", playable: true }];
  const localGames = [
    { id: "chess", name: "Chess", playable: true },
    { id: "ps5", name: "PS5", playable: false },
  ];

  assert.deepEqual(mergeGameCatalogue(serverGames, localGames), [
    serverGames[0],
    localGames[1],
  ]);
});

test("does not duplicate a platform card already returned by the server", () => {
  const serverGames = [{ id: "ps5", name: "PS5", playable: false }];

  assert.deepEqual(mergeGameCatalogue(serverGames, serverGames), serverGames);
});

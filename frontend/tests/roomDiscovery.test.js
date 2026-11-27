import assert from "node:assert/strict";
import test from "node:test";
import { filterRooms, getRoomAvailability, uniqueRooms } from "../src/roomDiscovery.js";

const rooms = [
  {
    id: 1,
    name: "Friday Chess",
    game_id: "chess",
    host: "playerone",
    status: "open",
    game_status: "not_started",
  },
  {
    id: 2,
    name: "Full Draughts",
    game_id: "draughts",
    host: "playertwo",
    status: "full",
    game_status: "not_started",
  },
  {
    id: 3,
    name: "Active Ludo",
    game_id: "ludo",
    host: "playerthree",
    status: "full",
    game_status: "active",
  },
  {
    id: 4,
    name: "Finished Whot",
    game_id: "whot",
    host: "playerfour",
    status: "full",
    game_status: "finished",
  },
];

test("maps backend room and game states to truthful discovery availability", () => {
  assert.deepEqual(rooms.map(getRoomAvailability), [
    "waiting",
    "full",
    "in-progress",
    "completed",
  ]);
});

test("filters rooms by game, availability, and searchable room metadata", () => {
  assert.deepEqual(
    filterRooms(rooms, { gameId: "chess", availability: "waiting" }).map((room) => room.id),
    [1],
  );
  assert.deepEqual(
    filterRooms(rooms, { search: "PLAYERTHREE", availability: "in-progress" }).map((room) => room.id),
    [3],
  );
});

test("deduplicates rooms by stable backend identifier", () => {
  assert.deepEqual(uniqueRooms([rooms[0], { ...rooms[0], name: "Latest room" }]), [
    { ...rooms[0], name: "Latest room" },
  ]);
});

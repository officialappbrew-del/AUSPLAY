export function uniqueRooms(rooms) {
  return [...new Map(rooms.map((room) => [room.id, room])).values()];
}

export function getRoomAvailability(room) {
  if (room.game_status === "active") return "in-progress";
  if (room.game_status === "finished") return "completed";
  if (room.status === "full") return "full";
  return "waiting";
}

export function filterRooms(rooms, { search = "", gameId = "all", availability = "all" } = {}) {
  const query = search.trim().toLocaleLowerCase();
  return uniqueRooms(rooms).filter((room) => {
    const matchesGame = gameId === "all" || room.game_id === gameId;
    const matchesAvailability = availability === "all"
      || getRoomAvailability(room) === availability;
    const searchableText = `${room.name} ${room.game_id} ${room.host}`.toLocaleLowerCase();
    return matchesGame && matchesAvailability && (!query || searchableText.includes(query));
  });
}

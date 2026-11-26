from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect


class RoomUpdateManager:
    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = {}

    def connect(self, room_id: int, websocket: WebSocket) -> None:
        self._connections.setdefault(room_id, set()).add(websocket)

    def disconnect(self, room_id: int, websocket: WebSocket) -> None:
        connections = self._connections.get(room_id)
        if connections is None:
            return
        connections.discard(websocket)
        if not connections:
            del self._connections[room_id]

    async def publish(self, room_id: int, version: int) -> None:
        message = {"type": "game_updated", "room_id": room_id, "version": version}
        for websocket in tuple(self._connections.get(room_id, ())):
            try:
                await websocket.send_json(message)
            except (OSError, RuntimeError, WebSocketDisconnect):
                self.disconnect(room_id, websocket)

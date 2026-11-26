import asyncio
import json
import os
import re
import secrets
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import case, func, literal, select, union_all, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from . import (
    chess_game,
    draughts,
    fair_dice,
    golf,
    ludo,
    models,
    polo,
    snooker,
    solo_games,
    whot,
)
from .db import SessionLocal, get_db
from .realtime import RoomUpdateManager
from .security import hash_password, make_token, read_token, verify_password

app = FastAPI(title="AusPlay API")
room_updates = RoomUpdateManager()
cors_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
bearer = HTTPBearer(auto_error=False)


@app.get("/")
def api_root():
    return {
        "service": "AusPlay API",
        "status": "ok",
        "docs": "/docs",
    }


class Credentials(BaseModel):
    username: str
    password: str
    age_confirmed: bool = False


class PracticeRoomCreate(BaseModel):
    game_id: str
    name: str
    max_players: int


class DraughtsMove(BaseModel):
    from_x: int
    from_y: int
    to_x: int
    to_y: int


class ChessMove(BaseModel):
    uci: str = Field(min_length=4, max_length=5, pattern=r"^[a-h][1-8][a-h][1-8][qrbn]?$")


class GolfScoreSubmission(BaseModel):
    strokes: int = Field(ge=1, le=golf.MAX_STROKES_PER_HOLE)


class PoloGoalsSubmission(BaseModel):
    goals: int = Field(ge=0, le=polo.MAX_GOALS_PER_CHUKKA)


class SnookerFrameScoreSubmission(BaseModel):
    break_points: int = Field(ge=0, le=snooker.MAX_BREAK_POINTS)


class SoloGameStart(BaseModel):
    level: int = Field(ge=1, le=solo_games.MAX_LEVEL)


class SoloGameAction(BaseModel):
    action: Literal["move", "roll", "token", "play_card", "draw", "score"]
    uci: str | None = Field(default=None, min_length=4, max_length=5)
    token_index: int | None = Field(default=None, ge=0, le=3)
    card_id: str | None = Field(default=None, min_length=1, max_length=20)
    chosen_suit: str | None = None
    value: int | None = Field(default=None, ge=0, le=155)


class LudoTokenMove(BaseModel):
    token_index: int


class LudoRoll(BaseModel):
    client_seed: str


class WhotCardPlay(BaseModel):
    card_id: str
    chosen_suit: str | None = None


GAME_PLAYER_LIMITS = {
    "ludo": (2, 4),
    "whot": (2, 4),
    "draughts": (2, 2),
    "chess": (2, 2),
    "golf": (2, 4),
    "polo": (2, 2),
    "snooker": (2, 2),
}
PLAYABLE_GAME_IDS = {"draughts", "ludo", "whot", "chess", "golf", "polo", "snooker"}
RULEBOOK_DEFAULTS = {
    "chess": {
        "title": "Standard Chess",
        "content": (
            "Standard chess rules apply, including castling, en passant, and pawn "
            "promotion. Checkmate wins; stalemate and automatic draws end in a draw."
        ),
    },
    "draughts": {
        "title": "English Draughts",
        "content": (
            "Men move forward, kings move in both directions, captures are mandatory, "
            "and a capturing piece must continue a possible multi-jump."
        ),
    },
    "golf": {
        "title": "AusPlay 9-hole Golf",
        "content": (
            "Play nine holes in turn. Players record their own completed strokes for each hole; "
            "the lowest total score wins. Scores are self-reported for friendly practice."
        ),
    },
    "ludo": {
        "title": "AusPlay Ludo",
        "content": (
            "Roll six to leave base and earn another roll. Safe squares prevent captures; "
            "finish with an exact roll. Captures do not grant an extra turn."
        ),
    },
    "polo": {
        "title": "AusPlay Four-Chukka Polo",
        "content": (
            "Each team captain records their team's goals after each of four chukkas. "
            "The team with the most goals wins; tied scores remain a draw. Scores are "
            "self-reported for friendly practice."
        ),
    },
    "snooker": {
        "title": "AusPlay Best-of-Three Snooker",
        "content": (
            "Each player records their frame break points in turn. The higher score wins the "
            "frame; a tied frame is not awarded. First to two frame wins takes the match. "
            "Scores are self-reported for friendly practice."
        ),
    },
    "whot": {
        "title": "AusPlay Whot",
        "content": (
            "Match suit or number. Action cards hold, suspend, or draw; WHOT 20 chooses "
            "the next suit. Penalty cards do not stack."
        ),
    },
}


class HostApplicationRequest(BaseModel):
    motivation: str = Field(min_length=30, max_length=1000)


class ReviewDecision(BaseModel):
    decision: Literal["approve", "reject"]
    note: str | None = Field(default=None, max_length=1000)


class RuleProposalRequest(BaseModel):
    game_id: str
    title: str = Field(min_length=3, max_length=80)
    content: str = Field(min_length=30, max_length=4000)


class ModerationReportRequest(BaseModel):
    room_id: int | None = None
    target_user_id: int | None = None
    category: Literal["cheating", "harassment", "inappropriate_content", "other"]
    details: str = Field(min_length=20, max_length=2000)


class ModerationReview(BaseModel):
    decision: Literal["resolve", "dismiss"]
    resolution: str = Field(min_length=10, max_length=1000)


class ResponsiblePlaySettingsRequest(BaseModel):
    break_reminder_minutes: Literal[0, 30, 60, 90, 120]


class GameDisputeRequest(BaseModel):
    details: str = Field(min_length=20, max_length=2000)


class PracticeRoomMessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=500)


class SoloDraughtsLevelCompletion(BaseModel):
    level: int = Field(ge=1, le=100)


def _is_admin(user: models.User) -> bool:
    return user.role == "admin"


def _is_host(user: models.User) -> bool:
    return user.role in {"host", "admin"} or _is_admin(user)


def _effective_role(user: models.User) -> str:
    return "admin" if _is_admin(user) else user.role


def _require_admin(user: models.User) -> models.User:
    if not _is_admin(user):
        raise HTTPException(403, "Administrator access required")
    return user


def _require_host(user: models.User) -> models.User:
    if not _is_host(user):
        raise HTTPException(403, "Approved Host access required")
    return user


def current_user(
    cred: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> models.User:
    uid = read_token(cred.credentials) if cred else None
    user = db.get(models.User, uid) if uid else None
    if not user:
        raise HTTPException(401, "Not authenticated")
    return user


@app.post("/auth/register")
def register(body: Credentials, db: Session = Depends(get_db)):
    if not re.fullmatch(r"[A-Za-z0-9_]{3,32}", body.username):
        raise HTTPException(422, "Username must be 3-32 letters, numbers or underscores")
    if len(body.password) < 8:
        raise HTTPException(422, "Password must be at least 8 characters")
    if not body.age_confirmed:
        raise HTTPException(422, "You must confirm that you are at least 18")
    if db.scalar(select(models.User).where(models.User.username == body.username.lower())):
        raise HTTPException(409, "Username already taken")
    user = models.User(username=body.username.lower(), password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    return {
        "token": make_token(user.id),
        "username": user.username,
        "role": _effective_role(user),
    }


@app.post("/auth/login")
def login(body: Credentials, db: Session = Depends(get_db)):
    user = db.scalar(select(models.User).where(models.User.username == body.username.lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Wrong username or password")
    return {
        "token": make_token(user.id),
        "username": user.username,
        "role": _effective_role(user),
    }


@app.get("/me")
def me(user: models.User = Depends(current_user)):
    return {"id": user.id, "username": user.username, "role": _effective_role(user)}


@app.get("/me/profile")
def my_player_profile(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    profile_games = (
        ("draughts", "Draughts", models.DraughtsGame),
        ("chess", "Chess", models.ChessGame),
        ("golf", "Golf", models.GolfGame),
        ("polo", "Polo", models.PoloGame),
        ("snooker", "Snooker", models.SnookerGame),
        ("ludo", "Ludo", models.LudoGame),
        ("whot", "Whot", models.WhotGame),
    )
    match_queries = [
        select(
            literal(game_id).label("game_id"),
            models.PracticeRoom.id.label("room_id"),
            models.PracticeRoom.name.label("room_name"),
            game_model.state.label("state"),
            game_model.updated_at.label("completed_at"),
        )
        .join(models.PracticeRoom, models.PracticeRoom.id == game_model.room_id)
        .join(
            models.PracticeRoomSeat,
            models.PracticeRoomSeat.room_id == models.PracticeRoom.id,
        )
        .where(
            models.PracticeRoomSeat.user_id == user.id,
            game_model.status == "finished",
        )
        for game_id, _, game_model in profile_games
    ]
    completed_matches = union_all(*match_queries).subquery()
    match_rows = db.execute(
        select(completed_matches).order_by(
            completed_matches.c.completed_at.desc(),
            completed_matches.c.room_id.desc(),
        )
    ).mappings().yield_per(500)

    per_game = {
        game_id: {
            "game_id": game_id,
            "name": name,
            "played": 0,
            "wins": 0,
            "draws": 0,
            "losses": 0,
        }
        for game_id, name, _ in profile_games
    }
    recent_matches = []
    recent_room_ids = set()
    for match in match_rows:
        state = match["state"]
        if state.get("status") != "finished":
            continue
        winner_user_ids = state.get("winner_user_ids")
        if winner_user_ids is None:
            winner_user_id = state.get("winner_user_id")
            winner_user_ids = [] if winner_user_id is None else [winner_user_id]

        if not winner_user_ids or (
            len(winner_user_ids) > 1 and user.id in winner_user_ids
        ):
            result = "draw"
        elif user.id in winner_user_ids:
            result = "win"
        else:
            result = "loss"

        game_stats = per_game[match["game_id"]]
        game_stats["played"] += 1
        result_stat = {"win": "wins", "draw": "draws", "loss": "losses"}[result]
        game_stats[result_stat] += 1
        if len(recent_matches) < 20:
            game_name = per_game[match["game_id"]]["name"]
            recent_matches.append(
                {
                    "room_id": match["room_id"],
                    "room_name": match["room_name"],
                    "game_id": match["game_id"],
                    "game_name": game_name,
                    "result": result,
                    "completed_at": match["completed_at"],
                    "opponents": [],
                }
            )
            recent_room_ids.add(match["room_id"])

    if recent_room_ids:
        participants = db.execute(
            select(models.PracticeRoomSeat.room_id, models.User.username)
            .join(models.User, models.User.id == models.PracticeRoomSeat.user_id)
            .where(models.PracticeRoomSeat.room_id.in_(recent_room_ids))
            .order_by(
                models.PracticeRoomSeat.room_id,
                models.PracticeRoomSeat.seat_number,
            )
        ).all()
        opponents_by_room: dict[int, list[str]] = {}
        for room_id, username in participants:
            if username != user.username:
                opponents_by_room.setdefault(room_id, []).append(username)
        for match in recent_matches:
            match["opponents"] = opponents_by_room.get(match["room_id"], [])

    total_played = sum(game["played"] for game in per_game.values())
    wins = sum(game["wins"] for game in per_game.values())
    solo_progress = db.get(models.SoloDraughtsProgress, user.id)
    return {
        "user": {
            "id": user.id,
            "username": user.username,
            "role": _effective_role(user),
            "member_since": user.created_at,
        },
        "stats": {
            "played": total_played,
            "wins": wins,
            "draws": sum(game["draws"] for game in per_game.values()),
            "losses": sum(game["losses"] for game in per_game.values()),
            "win_rate": round(wins / total_played * 100, 1) if total_played else 0,
        },
        "games": list(per_game.values()),
        "solo_draughts_highest_level": (
            solo_progress.highest_level if solo_progress else 1
        ),
        "recent_matches": recent_matches,
    }


@app.get("/rules")
def published_rulebooks(db: Session = Depends(get_db)):
    result = {}
    for game_id, default in RULEBOOK_DEFAULTS.items():
        published = db.get(models.PublishedRulebook, game_id)
        result[game_id] = (
            {
                "title": published.title,
                "content": published.content,
                "version": published.version,
            }
            if published
            else {**default, "version": 0}
        )
    return result


@app.get("/responsible-play/settings")
def get_responsible_play_settings(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    settings = db.scalar(
        select(models.ResponsiblePlaySettings).where(
            models.ResponsiblePlaySettings.user_id == user.id
        )
    )
    return {
        "break_reminder_minutes": settings.break_reminder_minutes if settings else 60
    }


@app.put("/responsible-play/settings")
def update_responsible_play_settings(
    body: ResponsiblePlaySettingsRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    settings = db.scalar(
        select(models.ResponsiblePlaySettings).where(
            models.ResponsiblePlaySettings.user_id == user.id
        )
    )
    if settings:
        settings.break_reminder_minutes = body.break_reminder_minutes
        settings.updated_at = models.now()
    else:
        settings = models.ResponsiblePlaySettings(
            user_id=user.id,
            break_reminder_minutes=body.break_reminder_minutes,
        )
        db.add(settings)
    db.commit()
    return {"break_reminder_minutes": settings.break_reminder_minutes}


@app.get("/rooms/{room_id}/disputes/me")
def get_my_game_dispute(
    room_id: int,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    room = db.get(models.PracticeRoom, room_id)
    if not room:
        raise HTTPException(404, "Practice room not found")
    _require_game_player(db, room_id, user.id)
    dispute = db.scalar(
        select(models.GameDispute)
        .where(
            models.GameDispute.room_id == room_id,
            models.GameDispute.reporter_user_id == user.id,
        )
        .order_by(models.GameDispute.created_at.desc())
    )
    if not dispute:
        return None
    return _game_dispute_response(dispute)


@app.post("/rooms/{room_id}/disputes", status_code=201)
def submit_game_dispute(
    room_id: int,
    body: GameDisputeRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    room = db.get(models.PracticeRoom, room_id)
    if not room:
        raise HTTPException(404, "Practice room not found")
    _require_game_player(db, room_id, user.id)
    game_models = {
        "draughts": models.DraughtsGame,
        "chess": models.ChessGame,
        "golf": models.GolfGame,
        "polo": models.PoloGame,
        "snooker": models.SnookerGame,
        "ludo": models.LudoGame,
        "whot": models.WhotGame,
    }
    game_model = game_models.get(room.game_id)
    if game_model is None:
        raise HTTPException(409, "This room has no supported game result")
    game = db.scalar(select(game_model).where(game_model.room_id == room_id))
    if (
        game is None
        or game.status != "finished"
        or game.state.get("status") != "finished"
    ):
        raise HTTPException(409, "A dispute can be filed only after the game is finished")
    details = body.details.strip()
    if len(details) < 20:
        raise HTTPException(422, "Dispute details must be at least 20 characters")
    existing = db.scalar(
        select(models.GameDispute.id).where(
            models.GameDispute.room_id == room_id,
            models.GameDispute.reporter_user_id == user.id,
            models.GameDispute.status == "open",
        )
    )
    if existing:
        raise HTTPException(409, "You already have an open dispute for this game")

    dispute = models.GameDispute(
        room_id=room_id,
        game_id=room.game_id,
        reporter_user_id=user.id,
        game_version=game.version,
        snapshot=_game_dispute_snapshot(room.game_id, game.state),
        details=details,
    )
    db.add(dispute)
    db.commit()
    return _game_dispute_response(dispute)


@app.get("/admin/disputes")
def admin_game_disputes(
    status: str = "open",
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    _require_admin(user)
    if status not in {"open", "resolved", "dismissed", "all"}:
        raise HTTPException(422, "Invalid dispute status")
    reporter = aliased(models.User)
    query = (
        select(models.GameDispute, reporter.username, models.PracticeRoom.name)
        .join(reporter, reporter.id == models.GameDispute.reporter_user_id)
        .join(models.PracticeRoom, models.PracticeRoom.id == models.GameDispute.room_id)
        .order_by(models.GameDispute.created_at)
    )
    if status != "all":
        query = query.where(models.GameDispute.status == status)
    return [
        {
            **_game_dispute_response(dispute),
            "reporter": username,
            "room_name": room_name,
        }
        for dispute, username, room_name in db.execute(query).all()
    ]


@app.post("/admin/disputes/{dispute_id}/review")
def review_game_dispute(
    dispute_id: int,
    body: ModerationReview,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    _require_admin(user)
    dispute = db.get(models.GameDispute, dispute_id)
    if not dispute:
        raise HTTPException(404, "Game dispute not found")
    if dispute.status != "open":
        raise HTTPException(409, "This game dispute has already been reviewed")
    dispute.status = "resolved" if body.decision == "resolve" else "dismissed"
    dispute.reviewed_by_user_id = user.id
    dispute.resolution = body.resolution.strip()
    dispute.reviewed_at = models.now()
    db.commit()
    return _game_dispute_response(dispute)


@app.get("/host/applications/me")
def my_host_application(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    application = db.scalar(
        select(models.HostApplication).where(models.HostApplication.user_id == user.id)
    )
    if not application:
        return None
    return {
        "id": application.id,
        "motivation": application.motivation,
        "status": application.status,
        "review_note": application.review_note,
        "created_at": application.created_at,
    }


@app.post("/host/applications", status_code=201)
def request_host_role(
    body: HostApplicationRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if _is_host(user):
        raise HTTPException(409, "Your account already has Host access")
    application = db.scalar(
        select(models.HostApplication).where(models.HostApplication.user_id == user.id)
    )
    if application and application.status == "pending":
        raise HTTPException(409, "Your Host application is already being reviewed")
    if application:
        application.motivation = body.motivation.strip()
        application.status = "pending"
        application.reviewed_by_user_id = None
        application.review_note = None
        application.created_at = models.now()
        application.reviewed_at = None
    else:
        application = models.HostApplication(
            user_id=user.id,
            motivation=body.motivation.strip(),
        )
        db.add(application)
    db.commit()
    return {
        "id": application.id,
        "status": application.status,
        "motivation": application.motivation,
    }


@app.get("/admin/host-applications")
def admin_host_applications(
    status: str = "pending",
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    _require_admin(user)
    if status not in {"pending", "approved", "rejected", "all"}:
        raise HTTPException(422, "Invalid application status")
    query = (
        select(models.HostApplication, models.User.username)
        .join(models.User, models.User.id == models.HostApplication.user_id)
        .order_by(models.HostApplication.created_at)
    )
    if status != "all":
        query = query.where(models.HostApplication.status == status)
    return [
        {
            "id": application.id,
            "user_id": application.user_id,
            "username": username,
            "motivation": application.motivation,
            "status": application.status,
            "created_at": application.created_at,
        }
        for application, username in db.execute(query).all()
    ]


@app.post("/admin/host-applications/{application_id}/review")
def review_host_application(
    application_id: int,
    body: ReviewDecision,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    _require_admin(user)
    application = db.get(models.HostApplication, application_id)
    if not application:
        raise HTTPException(404, "Host application not found")
    if application.status != "pending":
        raise HTTPException(409, "This Host application has already been reviewed")

    applicant = db.get(models.User, application.user_id)
    if applicant is None:
        raise HTTPException(409, "Applicant account no longer exists")
    application.status = "approved" if body.decision == "approve" else "rejected"
    application.reviewed_by_user_id = user.id
    application.review_note = body.note.strip() if body.note else None
    application.reviewed_at = models.now()
    if body.decision == "approve":
        applicant.role = "host"
    db.commit()
    return {
        "id": application.id,
        "username": applicant.username,
        "status": application.status,
        "role": applicant.role,
    }


@app.post("/rules/proposals", status_code=201)
def propose_rulebook(
    body: RuleProposalRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    _require_host(user)
    if body.game_id not in PLAYABLE_GAME_IDS:
        raise HTTPException(422, "Select a supported game")
    pending = db.scalar(
        select(models.RuleProposal.id).where(
            models.RuleProposal.created_by_user_id == user.id,
            models.RuleProposal.game_id == body.game_id,
            models.RuleProposal.status == "pending",
        )
    )
    if pending:
        raise HTTPException(409, "You already have a pending proposal for this game")
    proposal = models.RuleProposal(
        game_id=body.game_id,
        title=body.title.strip(),
        content=body.content.strip(),
        created_by_user_id=user.id,
    )
    db.add(proposal)
    db.commit()
    return {
        "id": proposal.id,
        "game_id": proposal.game_id,
        "title": proposal.title,
        "status": proposal.status,
    }


@app.get("/admin/rule-proposals")
def admin_rule_proposals(
    status: str = "pending",
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    _require_admin(user)
    if status not in {"pending", "approved", "rejected", "all"}:
        raise HTTPException(422, "Invalid proposal status")
    query = (
        select(models.RuleProposal, models.User.username)
        .join(models.User, models.User.id == models.RuleProposal.created_by_user_id)
        .order_by(models.RuleProposal.created_at)
    )
    if status != "all":
        query = query.where(models.RuleProposal.status == status)
    return [
        {
            "id": proposal.id,
            "game_id": proposal.game_id,
            "title": proposal.title,
            "content": proposal.content,
            "username": username,
            "status": proposal.status,
            "created_at": proposal.created_at,
        }
        for proposal, username in db.execute(query).all()
    ]


@app.post("/admin/rule-proposals/{proposal_id}/review")
def review_rule_proposal(
    proposal_id: int,
    body: ReviewDecision,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    _require_admin(user)
    proposal = db.get(models.RuleProposal, proposal_id)
    if not proposal:
        raise HTTPException(404, "Rule proposal not found")
    if proposal.status != "pending":
        raise HTTPException(409, "This rule proposal has already been reviewed")
    proposal.status = "approved" if body.decision == "approve" else "rejected"
    proposal.reviewed_by_user_id = user.id
    proposal.review_note = body.note.strip() if body.note else None
    proposal.reviewed_at = models.now()

    if body.decision == "approve":
        rulebook = db.get(models.PublishedRulebook, proposal.game_id)
        if rulebook:
            rulebook.title = proposal.title
            rulebook.content = proposal.content
            rulebook.version += 1
            rulebook.updated_by_user_id = user.id
            rulebook.updated_at = models.now()
        else:
            rulebook = models.PublishedRulebook(
                game_id=proposal.game_id,
                title=proposal.title,
                content=proposal.content,
                updated_by_user_id=user.id,
            )
            db.add(rulebook)
    db.commit()
    return {"id": proposal.id, "status": proposal.status}


@app.post("/reports", status_code=201)
def submit_moderation_report(
    body: ModerationReportRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if body.room_id is None and body.target_user_id is None:
        raise HTTPException(422, "A room or user must be selected")
    if body.target_user_id == user.id:
        raise HTTPException(422, "You cannot report your own account")
    if body.room_id is not None and db.get(models.PracticeRoom, body.room_id) is None:
        raise HTTPException(404, "Practice room not found")
    if (
        body.target_user_id is not None
        and db.get(models.User, body.target_user_id) is None
    ):
        raise HTTPException(404, "Reported user not found")
    if body.room_id is not None and body.target_user_id is not None:
        is_room_player = db.scalar(
            select(models.PracticeRoomSeat.id).where(
                models.PracticeRoomSeat.room_id == body.room_id,
                models.PracticeRoomSeat.user_id == body.target_user_id,
            )
        )
        if not is_room_player:
            raise HTTPException(422, "The reported user is not a player in that room")

    report = models.ModerationReport(
        reporter_user_id=user.id,
        room_id=body.room_id,
        target_user_id=body.target_user_id,
        category=body.category,
        details=body.details.strip(),
    )
    db.add(report)
    db.commit()
    return {"id": report.id, "status": report.status}


@app.get("/admin/reports")
def admin_moderation_reports(
    status: str = "open",
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    _require_admin(user)
    if status not in {"open", "resolved", "dismissed", "all"}:
        raise HTTPException(422, "Invalid report status")
    reporter = aliased(models.User)
    target = aliased(models.User)
    query = (
        select(
            models.ModerationReport,
            reporter.username,
            models.PracticeRoom.name,
            target.username,
        )
        .join(reporter, reporter.id == models.ModerationReport.reporter_user_id)
        .outerjoin(models.PracticeRoom, models.PracticeRoom.id == models.ModerationReport.room_id)
        .outerjoin(target, target.id == models.ModerationReport.target_user_id)
        .order_by(models.ModerationReport.created_at.desc())
    )
    if status != "all":
        query = query.where(models.ModerationReport.status == status)
    return [
        {
            "id": report.id,
            "reporter": reporter_name,
            "room_id": report.room_id,
            "room_name": room_name,
            "target_user_id": report.target_user_id,
            "target_username": target_name,
            "category": report.category,
            "details": report.details,
            "status": report.status,
            "created_at": report.created_at,
        }
        for report, reporter_name, room_name, target_name in db.execute(query).all()
    ]


@app.post("/admin/reports/{report_id}/review")
def review_moderation_report(
    report_id: int,
    body: ModerationReview,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    _require_admin(user)
    report = db.get(models.ModerationReport, report_id)
    if not report:
        raise HTTPException(404, "Moderation report not found")
    if report.status != "open":
        raise HTTPException(409, "This report has already been reviewed")
    report.status = "resolved" if body.decision == "resolve" else "dismissed"
    report.reviewed_by_user_id = user.id
    report.resolution = body.resolution.strip()
    report.reviewed_at = models.now()
    db.commit()
    return {"id": report.id, "status": report.status}


@app.websocket("/ws/rooms/{room_id}")
async def room_game_updates(websocket: WebSocket, room_id: int) -> None:
    await websocket.accept()
    try:
        message = json.loads(await asyncio.wait_for(websocket.receive_text(), timeout=10))
    except asyncio.TimeoutError:
        await websocket.close(code=4408)
        return
    except json.JSONDecodeError:
        await websocket.close(code=4400)
        return
    except WebSocketDisconnect:
        return

    token = message.get("token") if isinstance(message, dict) else None
    user_id = read_token(token) if isinstance(token, str) else None
    with SessionLocal() as db:
        user = db.get(models.User, user_id) if user_id else None
        room = db.get(models.PracticeRoom, room_id)
        seat = (
            db.scalar(
                select(models.PracticeRoomSeat.id).where(
                    models.PracticeRoomSeat.room_id == room_id,
                    models.PracticeRoomSeat.user_id == user_id,
                )
            )
            if user and room
            else None
        )
        version = (
            _room_game_version(db, room)
            if user is not None and room is not None and seat is not None
            else None
        )

    if user is None:
        await websocket.close(code=4401)
        return
    if room is None:
        await websocket.close(code=4404)
        return
    if seat is None:
        await websocket.close(code=4403)
        return
    if version is None and room.game_id not in PLAYABLE_GAME_IDS:
        await websocket.close(code=4409)
        return

    room_updates.connect(room_id, websocket)
    try:
        await websocket.send_json({"type": "connected", "version": version})
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        room_updates.disconnect(room_id, websocket)


@app.get("/games")
def games():
    # Placeholder catalogue: confirm the launch games, then load these from the database.
    return [
        {"id": "ludo", "name": "Ludo", "players": "2-4", "playable": True},
        {"id": "whot", "name": "Whot", "players": "2-4", "playable": True},
        {"id": "draughts", "name": "Draughts", "players": "2", "playable": True},
        {"id": "golf", "name": "Golf", "players": "2-4", "playable": True},
        {"id": "chess", "name": "Chess", "players": "2", "playable": True},
        {"id": "polo", "name": "Polo", "players": "2", "playable": True},
        {"id": "snooker", "name": "Snooker", "players": "2", "playable": True},
    ]


@app.get("/solo/draughts/progress")
def get_solo_draughts_progress(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    progress = db.get(models.SoloDraughtsProgress, user.id)
    return {"highest_level": progress.highest_level if progress else 1}


@app.post("/solo/draughts/progress/complete")
def complete_solo_draughts_level(
    body: SoloDraughtsLevelCompletion,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    progress = db.scalar(
        select(models.SoloDraughtsProgress)
        .where(models.SoloDraughtsProgress.user_id == user.id)
        .with_for_update()
    )
    highest_level = progress.highest_level if progress else 1
    if body.level > highest_level:
        raise HTTPException(409, "Complete your currently unlocked level first")

    unlocked_level = min(100, max(highest_level, body.level + 1))
    if progress is None:
        progress = models.SoloDraughtsProgress(
            user_id=user.id,
            highest_level=unlocked_level,
        )
        db.add(progress)
    elif unlocked_level > progress.highest_level:
        progress.highest_level = unlocked_level
        progress.updated_at = models.now()
    db.commit()
    return {"highest_level": unlocked_level}


def _solo_game_progress(user_id: int, game_id: str, db: Session) -> dict:
    progress = db.scalar(
        select(models.SoloGameProgress).where(
            models.SoloGameProgress.user_id == user_id,
            models.SoloGameProgress.game_id == game_id,
        )
    )
    return {
        "game_id": game_id,
        "highest_level": progress.highest_level if progress else 1,
        "max_level": solo_games.MAX_LEVEL,
    }


def _require_solo_game(game_id: str) -> None:
    if game_id not in solo_games.GAME_NAMES:
        raise HTTPException(404, "Solo play is not available for this game")


def _solo_game_response(
    solo_session: models.SoloGameSession,
    user: models.User,
) -> dict:
    state = solo_session.state
    computer_id = -user.id
    computer_name = f"Computer · Level {solo_session.level}"
    players = {
        str(user.id): user.username,
        str(computer_id): computer_name,
    }
    response = {
        "room_id": f"solo-{solo_session.id}",
        "solo_session_id": solo_session.id,
        "solo": True,
        "level": solo_session.level,
        "game_id": solo_session.game_id,
        "status": solo_session.status,
        "version": solo_session.version,
        "state": state,
        "players": players,
        "viewer": {
            "user_id": user.id,
            "is_turn": state["turn_user_id"] == user.id and solo_session.status == "active",
        },
    }
    if solo_session.game_id == "chess":
        response["players"] = {
            "white": user.username,
            "black": computer_name,
        }
        response["viewer"]["side"] = "white"
        response["legal_moves"] = chess_game.legal_moves(state, user.id)
    elif solo_session.game_id == "ludo":
        viewer_player = next(
            player for player in state["players"] if player["user_id"] == user.id
        )
        response["players"] = {
            player["color"]: (
                user.username
                if player["user_id"] == user.id
                else computer_name
            )
            for player in state["players"]
        }
        response["viewer"]["color"] = viewer_player["color"]
        response["legal_moves"] = ludo.legal_moves(state, user.id)
        response["fairness"] = {"available": False, "solo": True, "rolls": []}
    elif solo_session.game_id == "whot":
        response["state"] = {
            "players": [
                {
                    "user_id": player["user_id"],
                    "card_count": len(player["hand"]),
                    "hand": player["hand"] if player["user_id"] == user.id else [],
                }
                for player in state["players"]
            ],
            "draw_pile_count": len(state["draw_pile"]),
            "discard_top": state["discard_pile"][-1],
            "current_suit": state["current_suit"],
            "turn_user_id": state["turn_user_id"],
            "status": state["status"],
            "winner_user_id": state["winner_user_id"],
            "last_result": state["last_result"],
        }
        response["legal_moves"] = whot.legal_moves(state, user.id)
        response["can_draw"] = (
            state["status"] == "active"
            and state["turn_user_id"] == user.id
            and not response["legal_moves"]
        )
    return response


@app.get("/solo/{game_id}/progress")
def get_solo_game_progress(
    game_id: str,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    _require_solo_game(game_id)
    return _solo_game_progress(user.id, game_id, db)


@app.get("/solo/{game_id}/current")
def get_current_solo_game(
    game_id: str,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    _require_solo_game(game_id)
    solo_session = db.scalar(
        select(models.SoloGameSession)
        .where(
            models.SoloGameSession.user_id == user.id,
            models.SoloGameSession.game_id == game_id,
            models.SoloGameSession.status.in_(("active", "finished")),
        )
        .order_by(models.SoloGameSession.id.desc())
        .limit(1)
    )
    return {
        "session": (
            _solo_game_response(solo_session, user) if solo_session else None
        ),
        "progress": _solo_game_progress(user.id, game_id, db),
    }


@app.post("/solo/{game_id}/sessions", status_code=201)
def start_solo_game(
    game_id: str,
    body: SoloGameStart,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    _require_solo_game(game_id)
    progress = _solo_game_progress(user.id, game_id, db)
    if body.level > progress["highest_level"]:
        raise HTTPException(409, "Complete your currently unlocked level first")

    db.execute(
        update(models.SoloGameSession)
        .where(
            models.SoloGameSession.user_id == user.id,
            models.SoloGameSession.game_id == game_id,
            models.SoloGameSession.status == "active",
        )
        .values(status="abandoned", updated_at=models.now())
    )
    solo_session = models.SoloGameSession(
        user_id=user.id,
        game_id=game_id,
        level=body.level,
        state=solo_games.initial_state(game_id, user.id),
        status="active",
    )
    db.add(solo_session)
    db.commit()
    db.refresh(solo_session)
    return {
        "session": _solo_game_response(solo_session, user),
        "progress": progress,
    }


@app.post("/solo/{game_id}/sessions/{session_id}/actions")
def play_solo_game_action(
    game_id: str,
    session_id: int,
    body: SoloGameAction,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    _require_solo_game(game_id)
    solo_session = db.scalar(
        select(models.SoloGameSession)
        .where(
            models.SoloGameSession.id == session_id,
            models.SoloGameSession.user_id == user.id,
            models.SoloGameSession.game_id == game_id,
        )
        .with_for_update()
    )
    if solo_session is None:
        raise HTTPException(404, "Solo game not found")
    if solo_session.status != "active":
        raise HTTPException(409, "This solo game has finished")
    if solo_session.state["turn_user_id"] != user.id:
        raise HTTPException(409, "It is not your turn")
    try:
        new_state = solo_games.apply_player_action(
            game_id,
            solo_session.state,
            user.id,
            solo_session.level,
            body.model_dump(exclude_none=True),
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    new_version = solo_session.version + 1
    updated = db.execute(
        update(models.SoloGameSession)
        .where(
            models.SoloGameSession.id == solo_session.id,
            models.SoloGameSession.version == solo_session.version,
            models.SoloGameSession.status == "active",
        )
        .values(
            state=new_state,
            status=new_state["status"],
            version=new_version,
            updated_at=models.now(),
        )
        .execution_options(synchronize_session=False)
    )
    if updated.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "The game changed; refresh and try again")

    if new_state["status"] == "finished" and solo_games.player_won(new_state, user.id):
        progress = db.scalar(
            select(models.SoloGameProgress)
            .where(
                models.SoloGameProgress.user_id == user.id,
                models.SoloGameProgress.game_id == game_id,
            )
            .with_for_update()
        )
        unlocked_level = min(
            solo_games.MAX_LEVEL,
            max(progress.highest_level if progress else 1, solo_session.level + 1),
        )
        if progress is None:
            db.add(
                models.SoloGameProgress(
                    user_id=user.id,
                    game_id=game_id,
                    highest_level=unlocked_level,
                )
            )
        elif unlocked_level > progress.highest_level:
            progress.highest_level = unlocked_level
            progress.updated_at = models.now()
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "The game changed; refresh and try again") from exc

    db.refresh(solo_session)
    return {
        "session": _solo_game_response(solo_session, user),
        "progress": _solo_game_progress(user.id, game_id, db),
    }


@app.get("/rooms")
def practice_rooms(
    cred: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    viewer_id = read_token(cred.credentials) if cred else None
    if viewer_id is not None and db.get(models.User, viewer_id) is None:
        viewer_id = None
    rows = db.execute(
        select(
            models.PracticeRoom,
            models.User.username,
            func.count(models.PracticeRoomSeat.id),
            func.coalesce(
                models.DraughtsGame.status,
                models.ChessGame.status,
                models.GolfGame.status,
                models.PoloGame.status,
                models.SnookerGame.status,
                models.LudoGame.status,
                models.WhotGame.status,
            ),
            func.max(
                case(
                    (models.PracticeRoomSeat.user_id == viewer_id, 1),
                    else_=0,
                )
            ),
        )
        .join(models.User, models.User.id == models.PracticeRoom.host_user_id)
        .outerjoin(
            models.PracticeRoomSeat,
            models.PracticeRoomSeat.room_id == models.PracticeRoom.id,
        )
        .outerjoin(models.DraughtsGame, models.DraughtsGame.room_id == models.PracticeRoom.id)
        .outerjoin(models.ChessGame, models.ChessGame.room_id == models.PracticeRoom.id)
        .outerjoin(models.GolfGame, models.GolfGame.room_id == models.PracticeRoom.id)
        .outerjoin(models.PoloGame, models.PoloGame.room_id == models.PracticeRoom.id)
        .outerjoin(models.SnookerGame, models.SnookerGame.room_id == models.PracticeRoom.id)
        .outerjoin(models.LudoGame, models.LudoGame.room_id == models.PracticeRoom.id)
        .outerjoin(models.WhotGame, models.WhotGame.room_id == models.PracticeRoom.id)
        .group_by(
            models.PracticeRoom.id,
            models.User.username,
            models.DraughtsGame.status,
            models.ChessGame.status,
            models.GolfGame.status,
            models.PoloGame.status,
            models.SnookerGame.status,
            models.LudoGame.status,
            models.WhotGame.status,
        )
        .order_by(models.PracticeRoom.created_at.desc())
    ).all()
    return [
        {
            "id": room.id,
            "game_id": room.game_id,
            "name": room.name,
            "host": host_username,
            "players": player_count,
            "max_players": room.max_players,
            "status": "full" if player_count >= room.max_players else "open",
            "game_status": game_status or "not_started",
            "viewer_is_seated": bool(viewer_is_seated),
        }
        for room, host_username, player_count, game_status, viewer_is_seated in rows
    ]


@app.post("/rooms", status_code=201)
def create_practice_room(
    body: PracticeRoomCreate,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    limits = GAME_PLAYER_LIMITS.get(body.game_id)
    if not limits:
        raise HTTPException(422, "Select a supported game")
    if body.game_id not in PLAYABLE_GAME_IDS:
        raise HTTPException(422, "This game is not playable in practice rooms yet")
    if len(body.name.strip()) < 3 or len(body.name.strip()) > 40:
        raise HTTPException(422, "Room name must be 3-40 characters")
    if not limits[0] <= body.max_players <= limits[1]:
        raise HTTPException(
            422, f"{body.game_id.title()} rooms support {limits[0]}-{limits[1]} players"
        )

    room = models.PracticeRoom(
        game_id=body.game_id,
        name=body.name.strip(),
        host_user_id=user.id,
        max_players=body.max_players,
    )
    db.add(room)
    db.flush()
    db.add(
        models.PracticeRoomSeat(
            room_id=room.id,
            user_id=user.id,
            seat_number=1,
        )
    )
    db.commit()
    return {"id": room.id, "name": room.name, "game_id": room.game_id}


@app.post("/rooms/{room_id}/join")
async def join_practice_room(
    room_id: int,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    room = db.get(models.PracticeRoom, room_id)
    if not room:
        raise HTTPException(404, "Practice room not found")

    existing_seat = db.scalar(
        select(models.PracticeRoomSeat).where(
            models.PracticeRoomSeat.room_id == room.id,
            models.PracticeRoomSeat.user_id == user.id,
        )
    )
    if existing_seat:
        raise HTTPException(409, "You are already in this room")

    player_count = db.scalar(
        select(func.count(models.PracticeRoomSeat.id)).where(
            models.PracticeRoomSeat.room_id == room.id
        )
    )
    if player_count >= room.max_players:
        raise HTTPException(409, "This practice room is full")

    db.add(
        models.PracticeRoomSeat(
            room_id=room.id,
            user_id=user.id,
            seat_number=player_count + 1,
        )
    )
    player_total = player_count + 1
    game_started = (
        room.game_id in {"draughts", "chess"} and player_total == 2
    ) or (
        room.game_id in {"ludo", "whot", "golf", "polo", "snooker"}
        and player_total == room.max_players
    )
    if game_started:
        db.flush()
        seats = db.scalars(
            select(models.PracticeRoomSeat)
            .where(models.PracticeRoomSeat.room_id == room.id)
            .order_by(models.PracticeRoomSeat.seat_number)
        ).all()
        if room.game_id == "draughts":
            state = draughts.initial_state(seats[0].user_id, seats[1].user_id)
            game = models.DraughtsGame(
                room_id=room.id,
                red_player_id=seats[0].user_id,
                black_player_id=seats[1].user_id,
                state=state,
            )
            db.add(game)
            db.flush()
            db.add(
                models.PracticeGameEvent(
                    game_id=game.id,
                    sequence=0,
                    actor_user_id=None,
                    event_type="game_started",
                    payload={"game_id": "draughts"},
                    state=state,
                )
            )
        elif room.game_id == "chess":
            state = chess_game.initial_state(seats[0].user_id, seats[1].user_id)
            game = models.ChessGame(
                room_id=room.id,
                white_player_id=seats[0].user_id,
                black_player_id=seats[1].user_id,
                state=state,
            )
            db.add(game)
            db.flush()
            db.add(
                models.ChessGameEvent(
                    game_id=game.id,
                    sequence=0,
                    actor_user_id=None,
                    event_type="game_started",
                    payload={"game_id": "chess"},
                    state=state,
                )
            )
        elif room.game_id == "golf":
            state = golf.initial_state([seat.user_id for seat in seats])
            game = models.GolfGame(room_id=room.id, state=state)
            db.add(game)
            db.flush()
            db.add(
                models.GolfGameEvent(
                    game_id=game.id,
                    sequence=0,
                    actor_user_id=None,
                    event_type="game_started",
                    payload={"game_id": "golf", "players": [seat.user_id for seat in seats]},
                    state=state,
                )
            )
        elif room.game_id == "polo":
            state = polo.initial_state([seat.user_id for seat in seats])
            game = models.PoloGame(room_id=room.id, state=state)
            db.add(game)
            db.flush()
            db.add(
                models.PoloGameEvent(
                    game_id=game.id,
                    sequence=0,
                    actor_user_id=None,
                    event_type="game_started",
                    payload={"game_id": "polo", "teams": [seat.user_id for seat in seats]},
                    state=state,
                )
            )
        elif room.game_id == "snooker":
            state = snooker.initial_state([seat.user_id for seat in seats])
            game = models.SnookerGame(room_id=room.id, state=state)
            db.add(game)
            db.flush()
            db.add(
                models.SnookerGameEvent(
                    game_id=game.id,
                    sequence=0,
                    actor_user_id=None,
                    event_type="game_started",
                    payload={"game_id": "snooker", "players": [seat.user_id for seat in seats]},
                    state=state,
                )
            )
        else:
            if room.game_id == "ludo":
                server_seed = fair_dice.new_server_seed()
                state = ludo.initial_state([seat.user_id for seat in seats])
                state["_fairness"] = {
                    "server_seed": server_seed,
                    "server_seed_hash": fair_dice.server_seed_commitment(server_seed),
                }
                game = models.LudoGame(room_id=room.id, state=state)
                db.add(game)
                db.flush()
                db.add(
                    models.LudoGameEvent(
                        game_id=game.id,
                        sequence=0,
                        actor_user_id=None,
                        event_type="game_started",
                        payload={
                            "game_id": "ludo",
                            "server_seed_hash": state["_fairness"]["server_seed_hash"],
                        },
                        state=state,
                    )
                )
            else:
                state = whot.initial_state([seat.user_id for seat in seats])
                game = models.WhotGame(room_id=room.id, state=state)
                db.add(game)
                db.flush()
                db.add(
                    models.WhotGameEvent(
                        game_id=game.id,
                        sequence=0,
                        actor_user_id=None,
                        event_type="game_started",
                        payload={"game_id": "whot"},
                        state=state,
                    )
                )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Room changed while joining; refresh and try again") from exc
    if game_started:
        await room_updates.publish(room.id, 0)
    return {
        "room_id": room.id,
        "players": player_count + 1,
        "max_players": room.max_players,
        "game_started": game_started,
    }


@app.get("/rooms/{room_id}/game")
def get_practice_game(
    room_id: int,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    room = db.get(models.PracticeRoom, room_id)
    if not room:
        raise HTTPException(404, "Practice room not found")
    _require_game_player(db, room_id, user.id)
    if room.game_id == "whot":
        game = db.scalar(select(models.WhotGame).where(models.WhotGame.room_id == room_id))
        if not game:
            raise HTTPException(409, "The game starts when the room is full")
        return _whot_game_response(game, user, db)
    if room.game_id == "ludo":
        game = db.scalar(select(models.LudoGame).where(models.LudoGame.room_id == room_id))
        if not game:
            raise HTTPException(409, "The game starts when the room is full")
        return _ludo_game_response(game, user, db)
    if room.game_id == "chess":
        game = db.scalar(select(models.ChessGame).where(models.ChessGame.room_id == room_id))
        if not game:
            raise HTTPException(409, "The game starts when a second player joins")
        return _chess_game_response(game, user, db)
    if room.game_id == "golf":
        game = db.scalar(select(models.GolfGame).where(models.GolfGame.room_id == room_id))
        if not game:
            raise HTTPException(409, "The game starts when the room is full")
        return _golf_game_response(game, user, db)
    if room.game_id == "polo":
        game = db.scalar(select(models.PoloGame).where(models.PoloGame.room_id == room_id))
        if not game:
            raise HTTPException(409, "The game starts when the room is full")
        return _polo_game_response(game, user, db)
    if room.game_id == "snooker":
        game = db.scalar(
            select(models.SnookerGame).where(models.SnookerGame.room_id == room_id)
        )
        if not game:
            raise HTTPException(409, "The game starts when both players have joined")
        return _snooker_game_response(game, user, db)
    game = db.scalar(
        select(models.DraughtsGame).where(models.DraughtsGame.room_id == room_id)
    )
    if not game:
        raise HTTPException(409, "The game starts when a second player joins")
    return _game_response(game, user, db)


@app.get("/rooms/{room_id}/chat")
def get_practice_room_chat(
    room_id: int,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    room = db.get(models.PracticeRoom, room_id)
    if not room:
        raise HTTPException(404, "Practice room not found")
    _require_game_player(db, room_id, user.id)
    rows = db.execute(
        select(models.PracticeRoomMessage, models.User.username)
        .join(models.User, models.User.id == models.PracticeRoomMessage.user_id)
        .where(models.PracticeRoomMessage.room_id == room_id)
        .order_by(models.PracticeRoomMessage.id.desc())
        .limit(100)
    ).all()
    return {"messages": [_practice_room_message_response(message, username) for message, username in reversed(rows)]}


@app.post("/rooms/{room_id}/chat", status_code=201)
def send_practice_room_chat(
    room_id: int,
    body: PracticeRoomMessageRequest,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    room = db.get(models.PracticeRoom, room_id)
    if not room:
        raise HTTPException(404, "Practice room not found")
    _require_game_player(db, room_id, user.id)
    content = body.content.strip()
    if not content:
        raise HTTPException(422, "Message cannot be empty")
    message = models.PracticeRoomMessage(
        room_id=room_id,
        user_id=user.id,
        content=content,
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    return _practice_room_message_response(message, user.username)


@app.post("/rooms/{room_id}/chess/moves")
async def play_chess_move(
    room_id: int,
    body: ChessMove,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    game = _get_chess_game(db, room_id, user.id)
    try:
        new_state = chess_game.apply_move(game.state, user.id, body.uci)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    new_version = game.version + 1
    updated = db.execute(
        update(models.ChessGame)
        .where(
            models.ChessGame.id == game.id,
            models.ChessGame.version == game.version,
        )
        .values(
            state=new_state,
            status=new_state["status"],
            version=new_version,
            updated_at=models.now(),
        )
        .execution_options(synchronize_session=False)
    )
    if updated.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "The game changed; refresh and try your move again")

    db.add(
        models.ChessGameEvent(
            game_id=game.id,
            sequence=new_version,
            actor_user_id=user.id,
            event_type="move",
            payload={"uci": body.uci, "san": new_state["moves"][-1]["san"]},
            state=new_state,
        )
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "The game changed; refresh and try your move again") from exc
    db.refresh(game)
    response = _chess_game_response(game, user, db)
    await room_updates.publish(room_id, game.version)
    return response


@app.post("/rooms/{room_id}/golf/scores")
async def submit_golf_score(
    room_id: int,
    body: GolfScoreSubmission,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    game = _get_golf_game(db, room_id, user.id)
    try:
        new_state = golf.submit_score(game.state, user.id, body.strokes)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc

    new_version = game.version + 1
    updated = db.execute(
        update(models.GolfGame)
        .where(
            models.GolfGame.id == game.id,
            models.GolfGame.version == game.version,
        )
        .values(
            state=new_state,
            status=new_state["status"],
            version=new_version,
            updated_at=models.now(),
        )
        .execution_options(synchronize_session=False)
    )
    if updated.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "The game changed; refresh and try your score again")

    db.add(
        models.GolfGameEvent(
            game_id=game.id,
            sequence=new_version,
            actor_user_id=user.id,
            event_type="hole_score_submitted",
            payload={
                "hole": game.state["current_hole"],
                "strokes": body.strokes,
            },
            state=new_state,
        )
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "The game changed; refresh and try your score again") from exc
    db.refresh(game)
    response = _golf_game_response(game, user, db)
    await room_updates.publish(room_id, game.version)
    return response


@app.post("/rooms/{room_id}/polo/scores")
async def submit_polo_score(
    room_id: int,
    body: PoloGoalsSubmission,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    game = _get_polo_game(db, room_id, user.id)
    try:
        new_state = polo.submit_goals(game.state, user.id, body.goals)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc

    new_version = game.version + 1
    updated = db.execute(
        update(models.PoloGame)
        .where(
            models.PoloGame.id == game.id,
            models.PoloGame.version == game.version,
        )
        .values(
            state=new_state,
            status=new_state["status"],
            version=new_version,
            updated_at=models.now(),
        )
        .execution_options(synchronize_session=False)
    )
    if updated.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "The game changed; refresh and try your score again")

    db.add(
        models.PoloGameEvent(
            game_id=game.id,
            sequence=new_version,
            actor_user_id=user.id,
            event_type="chukka_score_submitted",
            payload={
                "chukka": game.state["current_chukka"],
                "goals": body.goals,
            },
            state=new_state,
        )
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "The game changed; refresh and try your score again") from exc
    db.refresh(game)
    response = _polo_game_response(game, user, db)
    await room_updates.publish(room_id, game.version)
    return response


@app.post("/rooms/{room_id}/snooker/scores")
async def submit_snooker_frame_score(
    room_id: int,
    body: SnookerFrameScoreSubmission,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    game = _get_snooker_game(db, room_id, user.id)
    try:
        new_state = snooker.submit_frame_score(game.state, user.id, body.break_points)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc

    new_version = game.version + 1
    updated = db.execute(
        update(models.SnookerGame)
        .where(
            models.SnookerGame.id == game.id,
            models.SnookerGame.version == game.version,
        )
        .values(
            state=new_state,
            status=new_state["status"],
            version=new_version,
            updated_at=models.now(),
        )
        .execution_options(synchronize_session=False)
    )
    if updated.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "The match changed; refresh and try your score again")

    db.add(
        models.SnookerGameEvent(
            game_id=game.id,
            sequence=new_version,
            actor_user_id=user.id,
            event_type="frame_score_submitted",
            payload={
                "frame": game.state["current_frame"],
                "break_points": body.break_points,
            },
            state=new_state,
        )
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "The match changed; refresh and try your score again") from exc
    db.refresh(game)
    response = _snooker_game_response(game, user, db)
    await room_updates.publish(room_id, game.version)
    return response


@app.post("/rooms/{room_id}/moves")
async def play_draughts_move(
    room_id: int,
    body: DraughtsMove,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    room = db.get(models.PracticeRoom, room_id)
    if not room:
        raise HTTPException(404, "Practice room not found")
    _require_game_player(db, room_id, user.id)
    if room.game_id != "draughts":
        raise HTTPException(409, "This room does not use Draughts moves")
    game = db.scalar(
        select(models.DraughtsGame).where(models.DraughtsGame.room_id == room_id)
    )
    if not game:
        raise HTTPException(409, "The game has not started")

    try:
        new_state = draughts.apply_move(
            game.state,
            user.id,
            body.from_x,
            body.from_y,
            body.to_x,
            body.to_y,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    new_version = game.version + 1
    updated = db.execute(
        update(models.DraughtsGame)
        .where(
            models.DraughtsGame.id == game.id,
            models.DraughtsGame.version == game.version,
        )
        .values(
            state=new_state,
            status=new_state["status"],
            version=new_version,
            updated_at=models.now(),
        )
        .execution_options(synchronize_session=False)
    )
    if updated.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "The game changed; refresh and try your move again")

    db.add(
        models.PracticeGameEvent(
            game_id=game.id,
            sequence=new_version,
            actor_user_id=user.id,
            event_type="move",
            payload={
                "from_x": body.from_x,
                "from_y": body.from_y,
                "to_x": body.to_x,
                "to_y": body.to_y,
            },
            state=new_state,
        )
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "The game changed; refresh and try your move again") from exc
    db.refresh(game)
    response = _game_response(game, user, db)
    await room_updates.publish(room_id, game.version)
    return response


@app.post("/rooms/{room_id}/roll")
async def roll_ludo_die(
    room_id: int,
    body: LudoRoll,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    game = _get_ludo_game(db, room_id, user.id)
    fairness = game.state.get("_fairness")
    if fairness is None:
        value = secrets.randbelow(6) + 1
        payload = {"value": value}
    else:
        nonce = game.version
        try:
            value = fair_dice.roll_value(
                fairness["server_seed"],
                body.client_seed,
                nonce,
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        payload = {"value": value, "client_seed": body.client_seed, "nonce": nonce}
    try:
        new_state = ludo.roll_die(game.state, user.id, value)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    response = _save_ludo_action(
        db,
        game,
        user,
        new_state,
        "die_rolled",
        payload,
    )
    await room_updates.publish(room_id, response["version"])
    return response


@app.post("/rooms/{room_id}/tokens/move")
async def move_ludo_token(
    room_id: int,
    body: LudoTokenMove,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    game = _get_ludo_game(db, room_id, user.id)
    if game.status != "active":
        raise HTTPException(409, "The game has finished")
    if game.state["turn_user_id"] != user.id or game.state["die_value"] is None:
        raise HTTPException(409, "Roll the die on your turn before moving a token")
    try:
        new_state = ludo.move_token(game.state, user.id, body.token_index)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    response = _save_ludo_action(
        db,
        game,
        user,
        new_state,
        "token_moved",
        {"token_index": body.token_index},
    )
    await room_updates.publish(room_id, response["version"])
    return response


@app.post("/rooms/{room_id}/cards/play")
async def play_whot_card(
    room_id: int,
    body: WhotCardPlay,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    game = _get_whot_game(db, room_id, user.id)
    try:
        new_state = whot.play_card(game.state, user.id, body.card_id, body.chosen_suit)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    response = _save_whot_action(
        db,
        game,
        user,
        new_state,
        "card_played",
        {"card_id": body.card_id, "chosen_suit": body.chosen_suit},
    )
    await room_updates.publish(room_id, response["version"])
    return response


@app.post("/rooms/{room_id}/cards/draw")
async def draw_whot_card(
    room_id: int,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    game = _get_whot_game(db, room_id, user.id)
    try:
        new_state = whot.draw_card(game.state, user.id)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    response = _save_whot_action(
        db,
        game,
        user,
        new_state,
        "card_drawn",
        {},
    )
    await room_updates.publish(room_id, response["version"])
    return response


@app.get("/wallet")
def wallet(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    total = db.scalar(
        select(func.coalesce(func.sum(models.LedgerEntry.amount), 0)).where(
            models.LedgerEntry.user_id == user.id, models.LedgerEntry.account == "available"
        )
    )
    return {"currency": "NGN", "available_kobo": total}


def _require_game_player(db: Session, room_id: int, user_id: int) -> None:
    seat = db.scalar(
        select(models.PracticeRoomSeat).where(
            models.PracticeRoomSeat.room_id == room_id,
            models.PracticeRoomSeat.user_id == user_id,
        )
    )
    if not seat:
        raise HTTPException(403, "You are not a player in this room")


def _practice_room_message_response(
    message: models.PracticeRoomMessage,
    username: str,
) -> dict:
    return {
        "id": message.id,
        "username": username,
        "content": message.content,
        "created_at": message.created_at,
    }


def _game_dispute_snapshot(game_id: str, state: dict) -> dict:
    if game_id == "ludo":
        return {key: value for key, value in state.items() if key != "_fairness"}
    if game_id == "whot":
        return {
            "players": [
                {"user_id": player["user_id"], "card_count": len(player["hand"])}
                for player in state["players"]
            ],
            "discard_top": state["discard_pile"][-1],
            "current_suit": state["current_suit"],
            "turn_user_id": state["turn_user_id"],
            "status": state["status"],
            "winner_user_id": state["winner_user_id"],
        }
    return state


def _game_dispute_response(dispute: models.GameDispute) -> dict:
    return {
        "id": dispute.id,
        "room_id": dispute.room_id,
        "game_id": dispute.game_id,
        "game_version": dispute.game_version,
        "snapshot": dispute.snapshot,
        "details": dispute.details,
        "status": dispute.status,
        "resolution": dispute.resolution,
        "created_at": dispute.created_at,
        "reviewed_at": dispute.reviewed_at,
    }


def _room_game_version(db: Session, room: models.PracticeRoom) -> int | None:
    game_models = {
        "draughts": models.DraughtsGame,
        "chess": models.ChessGame,
        "golf": models.GolfGame,
        "polo": models.PoloGame,
        "snooker": models.SnookerGame,
        "ludo": models.LudoGame,
        "whot": models.WhotGame,
    }
    game_model = game_models.get(room.game_id)
    if game_model is None:
        return None
    return db.scalar(select(game_model.version).where(game_model.room_id == room.id))


def _game_response(
    game: models.DraughtsGame,
    user: models.User,
    db: Session,
) -> dict:
    state = game.state
    side = "red" if user.id == game.red_player_id else "black"
    red_username = db.scalar(
        select(models.User.username).where(models.User.id == game.red_player_id)
    )
    black_username = db.scalar(
        select(models.User.username).where(models.User.id == game.black_player_id)
    )
    return {
        "room_id": game.room_id,
        "game_id": "draughts",
        "status": game.status,
        "version": game.version,
        "state": state,
        "players": {"red": red_username, "black": black_username},
        "viewer": {
            "user_id": user.id,
            "side": side,
            "is_turn": state["turn_user_id"] == user.id and game.status == "active",
        },
        "legal_moves": draughts.legal_moves(state, user.id),
    }


def _get_chess_game(db: Session, room_id: int, user_id: int) -> models.ChessGame:
    room = db.get(models.PracticeRoom, room_id)
    if not room:
        raise HTTPException(404, "Practice room not found")
    if room.game_id != "chess":
        raise HTTPException(409, "This practice room is not a Chess game")
    _require_game_player(db, room_id, user_id)
    game = db.scalar(select(models.ChessGame).where(models.ChessGame.room_id == room_id))
    if not game:
        raise HTTPException(409, "The game starts when a second player joins")
    return game


def _chess_game_response(
    game: models.ChessGame,
    user: models.User,
    db: Session,
) -> dict:
    state = game.state
    side = "white" if user.id == game.white_player_id else "black"
    white_username = db.scalar(
        select(models.User.username).where(models.User.id == game.white_player_id)
    )
    black_username = db.scalar(
        select(models.User.username).where(models.User.id == game.black_player_id)
    )
    return {
        "room_id": game.room_id,
        "game_id": "chess",
        "status": game.status,
        "version": game.version,
        "state": state,
        "players": {"white": white_username, "black": black_username},
        "viewer": {
            "user_id": user.id,
            "side": side,
            "is_turn": state["turn_user_id"] == user.id and game.status == "active",
        },
        "legal_moves": chess_game.legal_moves(state, user.id),
    }


def _get_golf_game(db: Session, room_id: int, user_id: int) -> models.GolfGame:
    room = db.get(models.PracticeRoom, room_id)
    if not room:
        raise HTTPException(404, "Practice room not found")
    if room.game_id != "golf":
        raise HTTPException(409, "This practice room is not a Golf game")
    _require_game_player(db, room_id, user_id)
    game = db.scalar(select(models.GolfGame).where(models.GolfGame.room_id == room_id))
    if not game:
        raise HTTPException(409, "The game starts when the room is full")
    return game


def _golf_game_response(
    game: models.GolfGame,
    user: models.User,
    db: Session,
) -> dict:
    state = game.state
    player_names = {
        str(player["user_id"]): db.scalar(
            select(models.User.username).where(models.User.id == player["user_id"])
        )
        for player in state["players"]
    }
    return {
        "room_id": game.room_id,
        "game_id": "golf",
        "status": game.status,
        "version": game.version,
        "state": state,
        "players": player_names,
        "viewer": {
            "user_id": user.id,
            "is_turn": state["turn_user_id"] == user.id and game.status == "active",
        },
    }


def _get_polo_game(db: Session, room_id: int, user_id: int) -> models.PoloGame:
    room = db.get(models.PracticeRoom, room_id)
    if not room:
        raise HTTPException(404, "Practice room not found")
    if room.game_id != "polo":
        raise HTTPException(409, "This practice room is not a Polo game")
    _require_game_player(db, room_id, user_id)
    game = db.scalar(select(models.PoloGame).where(models.PoloGame.room_id == room_id))
    if not game:
        raise HTTPException(409, "The game starts when both teams have joined")
    return game


def _polo_game_response(
    game: models.PoloGame,
    user: models.User,
    db: Session,
) -> dict:
    state = game.state
    player_names = {
        str(team["user_id"]): db.scalar(
            select(models.User.username).where(models.User.id == team["user_id"])
        )
        for team in state["teams"]
    }
    return {
        "room_id": game.room_id,
        "game_id": "polo",
        "status": game.status,
        "version": game.version,
        "state": state,
        "players": player_names,
        "viewer": {
            "user_id": user.id,
            "is_turn": state["turn_user_id"] == user.id and game.status == "active",
        },
    }


def _get_snooker_game(
    db: Session, room_id: int, user_id: int
) -> models.SnookerGame:
    room = db.get(models.PracticeRoom, room_id)
    if not room:
        raise HTTPException(404, "Practice room not found")
    if room.game_id != "snooker":
        raise HTTPException(409, "This practice room is not a Snooker game")
    _require_game_player(db, room_id, user_id)
    game = db.scalar(
        select(models.SnookerGame).where(models.SnookerGame.room_id == room_id)
    )
    if not game:
        raise HTTPException(409, "The game starts when both players have joined")
    return game


def _snooker_game_response(
    game: models.SnookerGame,
    user: models.User,
    db: Session,
) -> dict:
    state = game.state
    player_names = {
        str(player["user_id"]): db.scalar(
            select(models.User.username).where(models.User.id == player["user_id"])
        )
        for player in state["players"]
    }
    return {
        "room_id": game.room_id,
        "game_id": "snooker",
        "status": game.status,
        "version": game.version,
        "state": state,
        "players": player_names,
        "viewer": {
            "user_id": user.id,
            "is_turn": state["turn_user_id"] == user.id and game.status == "active",
        },
    }


def _get_ludo_game(db: Session, room_id: int, user_id: int) -> models.LudoGame:
    room = db.get(models.PracticeRoom, room_id)
    if not room:
        raise HTTPException(404, "Practice room not found")
    if room.game_id != "ludo":
        raise HTTPException(409, "This practice room is not a Ludo game")
    _require_game_player(db, room_id, user_id)
    game = db.scalar(select(models.LudoGame).where(models.LudoGame.room_id == room_id))
    if not game:
        raise HTTPException(409, "The game starts when the room is full")
    return game


def _get_whot_game(db: Session, room_id: int, user_id: int) -> models.WhotGame:
    room = db.get(models.PracticeRoom, room_id)
    if not room:
        raise HTTPException(404, "Practice room not found")
    if room.game_id != "whot":
        raise HTTPException(409, "This practice room is not a Whot game")
    _require_game_player(db, room_id, user_id)
    game = db.scalar(select(models.WhotGame).where(models.WhotGame.room_id == room_id))
    if not game:
        raise HTTPException(409, "The game starts when the room is full")
    return game


def _save_ludo_action(
    db: Session,
    game: models.LudoGame,
    user: models.User,
    new_state: dict,
    event_type: str,
    payload: dict,
) -> dict:
    new_version = game.version + 1
    updated = db.execute(
        update(models.LudoGame)
        .where(
            models.LudoGame.id == game.id,
            models.LudoGame.version == game.version,
        )
        .values(
            state=new_state,
            status=new_state["status"],
            version=new_version,
            updated_at=models.now(),
        )
        .execution_options(synchronize_session=False)
    )
    if updated.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "The game changed; refresh and try again")

    db.add(
        models.LudoGameEvent(
            game_id=game.id,
            sequence=new_version,
            actor_user_id=user.id,
            event_type=event_type,
            payload=payload,
            state=new_state,
        )
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "The game changed; refresh and try again") from exc
    db.refresh(game)
    return _ludo_game_response(game, user, db)


def _save_whot_action(
    db: Session,
    game: models.WhotGame,
    user: models.User,
    new_state: dict,
    event_type: str,
    payload: dict,
) -> dict:
    new_version = game.version + 1
    updated = db.execute(
        update(models.WhotGame)
        .where(
            models.WhotGame.id == game.id,
            models.WhotGame.version == game.version,
        )
        .values(
            state=new_state,
            status=new_state["status"],
            version=new_version,
            updated_at=models.now(),
        )
        .execution_options(synchronize_session=False)
    )
    if updated.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "The game changed; refresh and try again")

    db.add(
        models.WhotGameEvent(
            game_id=game.id,
            sequence=new_version,
            actor_user_id=user.id,
            event_type=event_type,
            payload=payload,
            state=new_state,
        )
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "The game changed; refresh and try again") from exc
    db.refresh(game)
    return _whot_game_response(game, user, db)


def _ludo_game_response(
    game: models.LudoGame,
    user: models.User,
    db: Session,
) -> dict:
    state = game.state
    viewer = next(
        (player for player in state["players"] if player["user_id"] == user.id),
        None,
    )
    if viewer is None:
        raise HTTPException(403, "You are not a player in this game")
    players = {
        player["color"]: db.scalar(
            select(models.User.username).where(models.User.id == player["user_id"])
        )
        for player in state["players"]
    }
    roll_events = db.scalars(
        select(models.LudoGameEvent)
        .where(
            models.LudoGameEvent.game_id == game.id,
            models.LudoGameEvent.event_type == "die_rolled",
        )
        .order_by(models.LudoGameEvent.sequence)
    ).all()
    private_fairness = state.get("_fairness")
    start_event = db.scalar(
        select(models.LudoGameEvent).where(
            models.LudoGameEvent.game_id == game.id,
            models.LudoGameEvent.sequence == 0,
            models.LudoGameEvent.event_type == "game_started",
        )
    )
    committed_hash = (
        start_event.payload.get("server_seed_hash") if start_event else None
    )
    proof_available = private_fairness is not None and committed_hash is not None
    fairness_proof = {
        "available": proof_available,
        "algorithm": "HMAC-SHA256 with rejection sampling v1",
        "server_seed_hash": committed_hash,
        "server_seed": (
            private_fairness["server_seed"]
            if proof_available and game.status == "finished"
            else None
        ),
        "rolls": [
            {
                "nonce": event.payload["nonce"],
                "client_seed": event.payload["client_seed"],
                "value": event.payload["value"],
            }
            for event in roll_events
            if "nonce" in event.payload and "client_seed" in event.payload
        ],
    }
    public_state = {key: value for key, value in state.items() if key != "_fairness"}
    return {
        "room_id": game.room_id,
        "game_id": "ludo",
        "status": game.status,
        "version": game.version,
        "state": public_state,
        "players": players,
        "viewer": {
            "user_id": user.id,
            "color": viewer["color"],
            "is_turn": state["turn_user_id"] == user.id and game.status == "active",
        },
        "legal_moves": ludo.legal_moves(state, user.id),
        "fairness": fairness_proof,
    }


def _whot_game_response(
    game: models.WhotGame,
    user: models.User,
    db: Session,
) -> dict:
    state = game.state
    viewer = next(
        (player for player in state["players"] if player["user_id"] == user.id),
        None,
    )
    if viewer is None:
        raise HTTPException(403, "You are not a player in this game")

    player_names = {}
    visible_players = []
    for player in state["players"]:
        player_names[player["user_id"]] = db.scalar(
            select(models.User.username).where(models.User.id == player["user_id"])
        )
        visible_players.append(
            {
                "user_id": player["user_id"],
                "card_count": len(player["hand"]),
                "hand": player["hand"] if player["user_id"] == user.id else [],
            }
        )

    public_state = {
        "players": visible_players,
        "draw_pile_count": len(state["draw_pile"]),
        "discard_top": state["discard_pile"][-1],
        "current_suit": state["current_suit"],
        "turn_user_id": state["turn_user_id"],
        "status": state["status"],
        "winner_user_id": state["winner_user_id"],
        "last_result": state["last_result"],
    }
    return {
        "room_id": game.room_id,
        "game_id": "whot",
        "status": game.status,
        "version": game.version,
        "state": public_state,
        "players": player_names,
        "viewer": {
            "user_id": user.id,
            "is_turn": state["turn_user_id"] == user.id and game.status == "active",
        },
        "legal_moves": whot.legal_moves(state, user.id),
        "can_draw": (
            state["status"] == "active"
            and state["turn_user_id"] == user.id
            and not whot.legal_moves(state, user.id)
        ),
    }

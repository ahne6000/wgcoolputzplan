from fastapi import APIRouter, Depends, HTTPException, Form
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Task, TaskAssignment, AssignmentStatus, TaskType
from ..services import (
    get_single_pending, has_any_assignee, inc_skip, log
)

router = APIRouter()

@router.post("/SwapCover")
def swap_cover(
    task_id: int = Form(...),
    cover_user_id: int = Form(...),
    db: Session = Depends(get_db)
):
    task = db.query(Task).get(int(task_id))
    if not task or task.task_type != TaskType.ROTATING:
        raise HTTPException(404, "Task not found or not ROTATING")

    pend = get_single_pending(db, task.id)
    if not pend or pend.user_id is None:
        raise HTTPException(409, "No assigned pending to cover")

    if pend.user_id == int(cover_user_id):
        raise HTTPException(400, "Already assigned to this user")

    # Vertretung: Assignment umhängen, Skip-Token für den Übernehmer
    prev_user = pend.user_id
    pend.user_id = int(cover_user_id)
    db.commit()

    inc_skip(db, task.id, int(cover_user_id), +1)

    log(db, "SWAP_COVER", actor_user_id=int(cover_user_id),
        details={"task_id": task.id, "prev_user_id": prev_user, "cover_user_id": int(cover_user_id), "assignment_id": pend.id},
        undo_data={"assignment_id": pend.id, "prev_user_id": prev_user, "task_id": task.id, "cover_user_id": int(cover_user_id), "skip_delta": +1})

    return {"ok": True}

@router.post("/SwapRotationOrder")
def swap_rotation_order(
    task_id: int = Form(...),
    user_a_id: int = Form(...),
    user_b_id: int = Form(...),
    db: Session = Depends(get_db)
):
    task = db.query(Task).get(int(task_id))
    if not task or task.task_type != TaskType.ROTATING or not task.rotation_user_ids:
        raise HTTPException(404, "Task not found or not ROTATING")
    order = list(task.rotation_user_ids)
    if int(user_a_id) not in order or int(user_b_id) not in order:
        raise HTTPException(400, "Both users must be in rotation")

    idx_a = order.index(int(user_a_id))
    idx_b = order.index(int(user_b_id))
    order[idx_a], order[idx_b] = order[idx_b], order[idx_a]
    prev_order = list(task.rotation_user_ids)
    task.rotation_user_ids = order
    db.commit()

    log(db, "SWAP_ROTATION", actor_user_id=None,
        details={"task_id": task.id, "user_a_id": int(user_a_id), "user_b_id": int(user_b_id), "new_order": order},
        undo_data={"task_id": task.id, "prev_order": prev_order})

    return {"ok": True, "rotation_order_user_ids": order}


@router.post("/SwapRotationOrderOneCycle")
def swap_rotation_order_one_cycle(
    task_id: int = Form(...),
    user_a_id: int = Form(...),
    user_b_id: int = Form(...),
    db: Session = Depends(get_db)
):
    task = db.query(Task).get(int(task_id))
    if not task or task.task_type != TaskType.ROTATING or not task.rotation_user_ids:
        raise HTTPException(404, "Task not found or not ROTATING")
    order = list(task.rotation_user_ids)
    a = int(user_a_id); b = int(user_b_id)
    if a not in order or b not in order:
        raise HTTPException(400, "Both users must be in rotation")
    if a == b:
        raise HTTPException(400, "Users must differ")

    # Original sichern & One-Cycle aktivieren
    prev_order = list(order)
    ia, ib = order.index(a), order.index(b)
    order[ia], order[ib] = order[ib], order[ia]
    task.rotation_user_ids = order
    db.commit()

    from ..services import set_one_cycle_swap, log
    set_one_cycle_swap(db, task, original_order=prev_order)

    log(db, "SWAP_ROTATION_ONE", actor_user_id=None,
        details={"task_id": task.id, "user_a_id": a, "user_b_id": b, "new_order": order},
        undo_data={"task_id": task.id, "prev_order": prev_order, "one_cycle": True})

    return {"ok": True, "rotation_order_user_ids": order, "reverts_after": len(prev_order)}

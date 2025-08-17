from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.orm import Session
from pathlib import Path
import uuid

from ..database import get_db
from ..models import User
from ..schemas import UserOut, UserCreate, AmountIn

router = APIRouter()

UPLOAD_DIR = Path("static/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

@router.get("/ListAllUser", response_model=list[UserOut])
def list_all_users(db: Session = Depends(get_db)):
    return db.query(User).order_by(User.id.asc()).all()

@router.post("/CreateUser", response_model=UserOut)
def create_user(data: UserCreate, db: Session = Depends(get_db)):
    u = User(name=data.name.strip())
    db.add(u); db.commit(); db.refresh(u)
    return u

@router.post("/UploadProfilePicture/{user_id}")
def upload_profile_picture(user_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    u = db.query(User).get(user_id)
    if not u:
        raise HTTPException(404, "User not found")
    ext = Path(file.filename).suffix or ".jpg"
    fname = f"{uuid.uuid4().hex}{ext}"
    path = UPLOAD_DIR / fname
    with path.open("wb") as f:
        f.write(file.file.read())
    u.profile_picture_url = f"/uploads/{fname}"
    db.commit()
    return {"url": u.profile_picture_url}

@router.post("/AddUserCredit/{user_id}")
def add_user_credit(user_id: int, amt: AmountIn, db: Session = Depends(get_db)):
    from ..services import log
    u = db.query(User).get(user_id)
    if not u:
        raise HTTPException(404, "User not found")
    delta = int(amt.amount)
    u.credits += delta
    db.commit()
    log(db, "ADD_CREDIT", actor_user_id=None, details={"user_id": user_id, "amount": delta}, undo_data={"user_id": user_id, "delta_was": delta})
    return {"ok": True, "credits": u.credits}

@router.post("/SubstractUserCredits/{user_id}")
def subtract_user_credit(user_id: int, amt: AmountIn, db: Session = Depends(get_db)):
    from ..services import log
    u = db.query(User).get(user_id)
    if not u:
        raise HTTPException(404, "User not found")
    delta = int(amt.amount)
    u.credits -= delta
    db.commit()
    log(db, "SUB_CREDIT", actor_user_id=None, details={"user_id": user_id, "amount": delta}, undo_data={"user_id": user_id, "delta_was": -delta})
    return {"ok": True, "credits": u.credits}

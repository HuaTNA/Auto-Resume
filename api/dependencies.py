"""
dependencies.py
FastAPI dependencies shared across routes.
"""

import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from api.auth import COOKIE_NAME, decode_token
from api.database import User, get_db


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """
    Extract and validate the JWT from the httpOnly cookie.
    Returns the authenticated User or raises HTTP 401.
    """
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired — please log in again")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return user

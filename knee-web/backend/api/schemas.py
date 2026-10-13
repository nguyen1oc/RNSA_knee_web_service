"""Pydantic request models shared by the API routers."""

from pydantic import BaseModel, Field


class ResumableUploadRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    size: int = Field(gt=0)


class FinalizeUploadsRequest(BaseModel):
    upload_ids: list[str] = Field(min_length=1, max_length=500)

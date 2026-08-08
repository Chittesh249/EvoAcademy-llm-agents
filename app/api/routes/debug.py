"""POST /debug — Auto-fix a runtime traceback in the active notebook."""
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Dict, List, Optional, Any
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.services.version_service import VersionService
from app.schemas.frontend_models import NotebookStructure, NotebookCell

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/llm")


class UnifiedDebugRequest(BaseModel):
    model_config = {"extra": "allow"}
    
    # Legacy fields
    session_id: Optional[str] = None
    traceback_msg: Optional[str] = None
    current_cells: Optional[Dict[str, str]] = None
    
    # New frontend fields
    user_id: Optional[str] = None
    notebook_id: Optional[str] = None
    traceback: Optional[str] = None
    notebook: Optional[NotebookStructure] = None


@router.post("/debug", response_model=Any)
async def debug_notebook(request: UnifiedDebugRequest, db: Session = Depends(get_db)):
    """
    Auto-fix a runtime error in the active notebook.
    Creates a new immutable version with the fixed code.
    If the fix fails validation, returns a 500 (no new version created).
    """
    session_id = request.session_id or request.notebook_id or request.user_id
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session_id or notebook_id")

    traceback_msg = request.traceback_msg or request.traceback
    if not traceback_msg:
        raise HTTPException(status_code=400, detail="Missing traceback_msg or traceback")

    # Extract current cells
    if request.notebook:
        current_cells = {}
        for cell in request.notebook.cells:
            if cell.cell_name:
                current_cells[cell.cell_name] = cell.source
    else:
        current_cells = request.current_cells or {}

    logger.info(f"[/debug] session={session_id}")
    
    deap_order = [
        "imports", "config", "creator", "evaluation", "crossover", "mutation", "selection",
        "initialization", "toolbox", "main_algorithm", "stats", "visualization"
    ]

    try:
        svc = VersionService(db)
        result = await svc.debug(
            session_id=session_id,
            traceback_msg=traceback_msg,
            current_cells=current_cells,
        )

        cells_modified_indices = []
        cells_modified_names = result.get("cells_modified", [])
        for name in cells_modified_names:
            if name in deap_order:
                cells_modified_indices.append(deap_order.index(name))

        if request.notebook:
            cells = []
            flat_cells = result.get("cells", {})
            for idx, name in enumerate(deap_order):
                cells.append(NotebookCell(
                    cell_type="code",
                    cell_name=name,
                    source=flat_cells.get(name, ""),
                    metadata={"cell_index": idx}
                ))
            notebook_struct = NotebookStructure(
                cells=cells,
                requirements="deap\nnumpy\nmatplotlib"
            )
            return {
                "notebook_id": session_id,
                "notebook": notebook_struct.model_dump(),
                "fixes_applied": [result.get("tutor_explanation", "Fixed tracebacks")],
                "validation_passed": True,
                "requirements": "deap\nnumpy\nmatplotlib",
                "message": result.get("tutor_explanation", "Notebook fixed successfully")
            }
        else:
            return {
                "status": "success",
                "cells": result.get("cells", {}),
                "cells_modified": cells_modified_names,
                "tutor_explanation": result.get("tutor_explanation", ""),
                "version_number": result.get("version_number", 0),
                "version_id": result.get("version_id", "")
            }

    except Exception as e:
        logger.exception(f"[/debug] Failed: {e}")
        try:
            svc = VersionService(db)
            active_cells_obj = svc.get_active_cells(session_id)
            active_cells = active_cells_obj.to_dict() if active_cells_obj else {}

            notebook = svc.notebook_repo.get_notebook_by_session(session_id)
            active_ver_num = 1
            active_ver_id = ""
            if notebook and notebook.active_version_id:
                active_ver = svc.version_repo.get_version_by_id(notebook.active_version_id)
                if active_ver:
                    active_ver_num = active_ver.version_number
                    active_ver_id = active_ver.version_id

            if request.notebook:
                cells = []
                for idx, name in enumerate(deap_order):
                    cells.append(NotebookCell(
                        cell_type="code",
                        cell_name=name,
                        source=active_cells.get(name, ""),
                        metadata={"cell_index": idx}
                    ))
                notebook_struct = NotebookStructure(
                    cells=cells,
                    requirements="deap\nnumpy\nmatplotlib"
                )
                return {
                    "notebook_id": session_id,
                    "notebook": notebook_struct.model_dump(),
                    "fixes_applied": [],
                    "validation_passed": False,
                    "requirements": "deap\nnumpy\nmatplotlib",
                    "message": f"Debug pipeline error: {str(e)}. Automatically rolled back to the previous working version."
                }
            else:
                return {
                    "status": "reverted",
                    "cells": active_cells,
                    "cells_modified": [],
                    "tutor_explanation": f"Debug pipeline error: {str(e)}. Automatically rolled back to the previous working version.",
                    "version_number": active_ver_num,
                    "version_id": active_ver_id,
                }
        except Exception as fallback_err:
            logger.exception(f"[/debug] Rollback fallback failed: {fallback_err}")
            raise HTTPException(status_code=500, detail=str(e))

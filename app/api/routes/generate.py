"""POST /generate — Generate a brand-new EA notebook."""
import logging
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.services.version_service import VersionService
from app.schemas.frontend_models import NotebookStructure, NotebookCell
from app.utils.request_parser import RequestParser

logger = logging.getLogger(__name__)
router = APIRouter()


class GenerateRequest(BaseModel):
    model_config = {"extra": "allow"}
    
    # Legacy fields
    session_id: Optional[str] = None
    prompt: Optional[str] = None
    
    # New frontend fields
    user_id: Optional[str] = None
    notebook_id: Optional[str] = None


class UnifiedGenerateResponse(BaseModel):
    # Legacy fields
    status: str
    target_problem: str
    cells: Dict[str, str]
    compiled_script: str
    version_number: int
    version_id: str
    
    # New frontend fields
    notebook_id: str
    notebook: NotebookStructure
    requirements: str
    message: str = "Notebook generated successfully"


def format_prompt_from_data(data: dict) -> str:
    lines = []
    if data.get("problem_name"):
        lines.append(f"Problem Name: {data['problem_name']}")
    if data.get("goal_description"):
        lines.append(f"Goal: {data['goal_description']}")
    if data.get("fitness_description"):
        lines.append(f"Fitness: {data['fitness_description']}")
    if data.get("objective_function"):
        lines.append(f"Objective Function: {data['objective_function']}")
    if data.get("solution_representation"):
        lines.append(f"Solution Representation: {data['solution_representation']} of size {data.get('solution_size', 10)}")
    if data.get("selection_method"):
        lines.append(f"Selection: {data['selection_method']}")
    if data.get("crossover_operator"):
        lines.append(f"Crossover: {data['crossover_operator']} with prob {data.get('crossover_probability', 0.7)}")
    if data.get("mutation_operator"):
        lines.append(f"Mutation: {data['mutation_operator']} with prob {data.get('mutation_probability', 0.2)}")
    if data.get("population_size"):
        lines.append(f"Population Size: {data['population_size']}")
    if data.get("num_generations"):
        lines.append(f"Generations: {data['num_generations']}")
    if data.get("other_specifications"):
        lines.append(f"Other Specs: {json.dumps(data['other_specifications'])}")
    return "\n".join(lines)


@router.post("/generate", response_model=UnifiedGenerateResponse)
@router.post("/v1/generate", response_model=UnifiedGenerateResponse)
async def generate_notebook(request: GenerateRequest, db: Session = Depends(get_db)):
    """
    Generate a brand-new evolutionary algorithm notebook.
    Creates version_1.ipynb in storage/notebooks/session_{id}/.
    Any previous history for this session is cleared.
    """
    # 1. Parse session_id
    session_id = request.session_id or request.notebook_id or request.user_id
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session_id or notebook_id")

    # 2. Parse prompt
    prompt = request.prompt
    if not prompt:
        # Extract structured specifications and compile prompt
        problem_data = RequestParser.extract_structured_data(request)
        prompt = format_prompt_from_data(problem_data)

    logger.info(f"[/generate] session={session_id} prompt='{prompt[:60]}'")
    try:
        svc = VersionService(db)
        result = await svc.generate(session_id=session_id, prompt=prompt)
        
        # Build NotebookStructure cells list
        deap_order = [
            "imports", "config", "creator", "evaluation", "crossover", "mutation", "selection",
            "initialization", "toolbox", "main_algorithm", "stats", "visualization"
        ]
        cells = []
        flat_cells = result.get("cells", {})
        for idx, name in enumerate(deap_order):
            source_code = flat_cells.get(name, "")
            cells.append(NotebookCell(
                cell_type="code",
                cell_name=name,
                source=source_code,
                metadata={"cell_index": idx}
            ))

        notebook_struct = NotebookStructure(
            cells=cells,
            requirements="deap\nnumpy\nmatplotlib"
        )

        return UnifiedGenerateResponse(
            status=result.get("status", "success"),
            target_problem=result.get("target_problem", ""),
            cells=flat_cells,
            compiled_script=result.get("compiled_script", ""),
            version_number=result.get("version_number", 0),
            version_id=result.get("version_id", ""),
            notebook_id=session_id,
            notebook=notebook_struct,
            requirements="deap\nnumpy\nmatplotlib",
            message="Notebook generated successfully"
        )
    except ValueError as e:
        logger.warning(f"[/generate] Validation failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"[/generate] Failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

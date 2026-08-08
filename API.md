# EvoAcademy API Documentation

Welcome to the EvoAcademy backend API documentation. The API serves as the backbone for generating, refining, debugging, and managing the version history of DEAP Evolutionary Algorithm (EA) Jupyter Notebooks.

**Base URL**: `http://localhost:8000` (or your deployed server address, e.g. Render)

> All routes use the `/api/v1/` prefix to match the standard frontend structure.

---

## 1. System Health

### GET `/health`
Check if the API is running and accessible.

**Request Body**: None

**Response**:
```json
{
  "status": "ok",
  "version": "2.0.0",
  "features": ["version_history", "semantic_search", "rollback", "user_preferences"]
}
```
**How to Use**: Call this endpoint when the frontend application first loads to ensure the backend server is reachable.

---

## 2. Notebook Generation & Refinement

### POST `/api/v1/llm/generate`
Generate a brand-new evolutionary algorithm notebook from a natural language prompt. This creates `version_1.ipynb` and clears any previous history for the provided session.

**Request Body** (`application/json`):
```json
{
  "session_id": "string (Unique ID for the learning session)",
  "prompt": "string (The student's raw prompt for the EA problem)"
}
```

**Response**:
```json
{
  "status": "string",
  "target_problem": "string",
  "cells": {
    "imports": "...",
    "config": "...",
    "creator": "...",
    "evaluation": "...",
    "crossover": "...",
    "mutation": "...",
    "selection": "...",
    "initialization": "...",
    "toolbox": "...",
    "main_algorithm": "...",
    "stats": "...",
    "visualization": "..."
  },
  "compiled_script": "string (The concatenated python script of all cells)",
  "version_number": 1,
  "version_id": "string (UUID for the generated version)"
}
```
**How to Use**: Use this when a student submits their very first problem prompt. The returned `cells` dictionary maps directly to the 12 DEAP code block editors in the frontend.

### POST `/api/v1/llm/refine`
Refine an existing notebook based on a follow-up question or modification request. Creates a new immutable version without overwriting previous history.

**Request Body** (`application/json`):
```json
{
  "session_id": "string",
  "user_prompt": "string (The student's question or modification request)",
  "current_cells": {
    "imports": "...",
    "config": "..."
  }
}
```

**Response**:
```json
{
  "status": "string",
  "cells": { },
  "cells_modified": ["string (e.g., 'crossover', 'toolbox')"],
  "tutor_explanation": "string (Markdown explanation from the AI tutor)",
  "version_number": 2,
  "version_id": "string"
}
```
**How to Use**: Trigger this when the user asks a follow-up question in the chat. Display `tutor_explanation` as a markdown message. Use `cells_modified` to visually highlight which code blocks were updated.

### POST `/api/v1/llm/debug`
Auto-fix a runtime error (traceback) thrown by code execution. Creates a new immutable version containing the fixed code.

**Request Body** (`application/json`):
```json
{
  "session_id": "string",
  "traceback_msg": "string (The raw runtime error)",
  "current_cells": { }
}
```

**Response**:
```json
{
  "status": "string",
  "cells": { },
  "cells_modified": ["string"],
  "tutor_explanation": "string (Explanation of what caused the bug and how it was fixed)",
  "version_number": 3,
  "version_id": "string"
}
```
**How to Use**: When the user pastes a traceback in the chat, automatically route to this endpoint instead of `/refine`. The frontend auto-detects tracebacks via the pattern `"Traceback (most recent call last)"`.

---

## 3. Version History & Time Travel

### GET `/api/v1/sessions/{session_id}/history`
Returns the complete, chronological version timeline for a specific session.

**Path Parameters**:
- `session_id`: Unique identifier for the active session.

**Response**:
```json
[
  {
    "version_number": 1,
    "operation_type": "generate",
    "prompt": "Solve TSP",
    "summary": "Initial generation",
    "is_active": false,
    "file_path": "storage/notebooks/session_id/version_1.ipynb",
    "checksum": "hash_string",
    "cells_modified": [],
    "created_at": "timestamp"
  }
]
```
**How to Use**: Fetch this on session load to populate the History panel. Use `is_active` to highlight the current version.

### POST `/api/v1/sessions/{session_id}/rollback`
Rolls back the active state to a previous version. Pure metadata operation — no files are deleted.

**Path Parameters**:
- `session_id`: Unique identifier for the active session.

**Request Body** (`application/json`):
```json
{
  "version_number": 1
}
```

**Response**:
```json
{
  "status": "success",
  "message": "Rolled back to version 1",
  "active_version": {
      "version_number": 1,
      "cells": { }
  }
}
```
**How to Use**: Trigger this when a user clicks "↩ Rollback" in the History panel. The frontend immediately updates the code editors with the returned `cells` dictionary.

### GET `/api/v1/sessions/{session_id}/search`
Perform a natural language semantic search over the notebook version history using ChromaDB vector embeddings.

**Path Parameters**:
- `session_id`: Unique identifier for the active session.

**Query Parameters**:
- `q`: string (Natural language query, e.g. "version where tournament selection was added")
- `n`: int (Max number of results to return, default is 5)

**Response**:
```json
[
  {
    "version_number": 2,
    "summary": "Added tournament selection logic to toolbox.",
    "similarity_score": 0.89
  }
]
```
**How to Use**: Wire to the search bar in the History panel. Users type natural language queries to instantly find past changes.

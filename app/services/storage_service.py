"""
StorageService — Reads and writes notebook files to disk.

Delta compression strategy
--------------------------
* Version 1 (generate) and every SNAPSHOT_INTERVAL-th version are stored as
  full `.ipynb` files  (is_snapshot=True).
* All other versions are stored as `.delta.json` files containing only the
  cells that changed relative to their nearest snapshot ancestor.

Reconstruction is transparent: `load_notebook()` auto-detects the file type
and replays the delta chain when needed.

Storage layout:
  storage/notebooks/
    session_{session_id}/
      version_1.ipynb          ← full snapshot
      version_2.delta.json     ← delta
      version_3.delta.json     ← delta
      ...
      version_10.ipynb         ← full snapshot (periodic)
      active.ipynb             ← live working document (always full)
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Callable, Dict, Optional, Tuple

import nbformat
from nbformat.v4 import new_code_cell, new_notebook

from app.schemas.notebook import DEAP_CELL_ORDER, CellDelta, NotebookCells

logger = logging.getLogger(__name__)

# How often to force a full snapshot (v1 is always a snapshot)
SNAPSHOT_INTERVAL: int = 10

# Root storage directory (relative to project root)
STORAGE_ROOT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "storage", "notebooks"
)


def should_be_snapshot(version_number: int) -> bool:
    """True for v1 and every SNAPSHOT_INTERVAL-th version."""
    return version_number == 1 or version_number % SNAPSHOT_INTERVAL == 0


class StorageService:
    """
    File I/O for notebook versions.

    Public API
    ----------
    save_notebook(session_id, version_number, cells, parent_cells) -> (path, checksum, is_snapshot, delta_size)
    load_notebook(file_path, get_ancestor_cells?)                   -> NotebookCells
    update_active_notebook(session_id, cells)                       -> str (path)
    checksum_matches(file_path, expected_checksum)                  -> bool
    """

    # ------------------------------------------------------------------
    # Save
    # ------------------------------------------------------------------

    def save_notebook(
        self,
        session_id: str,
        version_number: int,
        cells: NotebookCells,
        parent_cells: Optional[NotebookCells] = None,
        get_ancestor_cells: Optional[Callable[[int], Optional[NotebookCells]]] = None,
    ) -> Tuple[str, str, bool, Optional[int]]:
        """
        Persist a notebook version to disk using delta compression where possible.

        Parameters
        ----------
        session_id        : session identifier
        version_number    : the new version number
        cells             : full NotebookCells for this version
        parent_cells      : full NotebookCells of the direct parent version
                            (None forces a snapshot, e.g. first generate)
        get_ancestor_cells: callable(base_version_number) → NotebookCells | None
                            Used to load the base snapshot for delta diffing.
                            If None, falls back to diffing against parent_cells
                            (less accurate but safe for v2).

        Returns
        -------
        (relative_file_path, sha256_checksum, is_snapshot, delta_size_bytes)
        delta_size_bytes is None for snapshots.
        """
        session_dir = os.path.join(STORAGE_ROOT, f"session_{session_id}")
        os.makedirs(session_dir, exist_ok=True)

        is_snap = should_be_snapshot(version_number) or parent_cells is None

        if is_snap:
            rel_path, checksum = self._save_snapshot(session_dir, session_id, version_number, cells)
            delta_size = None
        else:
            rel_path, checksum, delta_size = self._save_delta(
                session_dir, version_number, cells, parent_cells,
                get_ancestor_cells=get_ancestor_cells,
            )

        logger.info(
            f"[Storage] Saved v{version_number} {'(snapshot)' if is_snap else '(delta)'} "
            f"→ {rel_path} (checksum={checksum[:12]}...)"
        )

        # Keep the live active.ipynb up to date
        self.update_active_notebook(session_id, cells)

        return rel_path, checksum, is_snap, delta_size

    def _save_snapshot(
        self,
        session_dir: str,
        session_id: str,
        version_number: int,
        cells: NotebookCells,
    ) -> Tuple[str, str]:
        """Write a full .ipynb snapshot. Returns (rel_path, checksum)."""
        file_name = f"version_{version_number}.ipynb"
        abs_path = os.path.join(session_dir, file_name)

        nb = new_notebook()
        ordered_cells = []
        cells_dict = cells.to_ordered_dict()
        for cell_name in DEAP_CELL_ORDER:
            code = cells_dict.get(cell_name, "")
            if code:
                cc = new_code_cell(source=code)
                cc.metadata["cell_name"] = cell_name
                ordered_cells.append(cc)
        # Extra cells not in DEAP_CELL_ORDER
        for cell_name, code in cells.to_dict().items():
            if cell_name not in DEAP_CELL_ORDER and code:
                cc = new_code_cell(source=code)
                cc.metadata["cell_name"] = cell_name
                ordered_cells.append(cc)

        nb.cells = ordered_cells
        nb.metadata["session_id"] = session_id
        nb.metadata["version_number"] = version_number

        with open(abs_path, "w", encoding="utf-8") as f:
            nbformat.write(nb, f)

        checksum = self._compute_checksum(abs_path)
        rel_path = self._rel(abs_path)
        return rel_path, checksum

    def _save_delta(
        self,
        session_dir: str,
        version_number: int,
        cells: NotebookCells,
        parent_cells: NotebookCells,
        get_ancestor_cells: Optional[Callable[[int], Optional[NotebookCells]]] = None,
    ) -> Tuple[str, str, int]:
        """
        Compute and write a .delta.json file.
        Returns (rel_path, checksum, delta_size_bytes).

        base_version_number is set to the most recent snapshot ≤ (version_number - 1).
        The delta is stored as the diff between `cells` and the BASE SNAPSHOT
        (not the direct parent).  This guarantees that apply_to(base_snapshot)
        correctly reconstructs the full state for any version in the chain.

        If the base snapshot cannot be loaded, we fall back to diffing against
        parent_cells.  That only works perfectly when (version_number == 2),
        i.e. direct child of the snapshot, so a warning is emitted otherwise.
        """
        # Nearest snapshot version number
        prev = version_number - 1
        if prev % SNAPSHOT_INTERVAL == 0:
            base_ver = prev
        else:
            # Walk back to the most recent snapshot multiple
            base_ver = (prev // SNAPSHOT_INTERVAL) * SNAPSHOT_INTERVAL or 1

        # Load the base snapshot to diff against — this is the anchor that
        # apply_to() will use during reconstruction.
        base_cells: NotebookCells = parent_cells  # safe fallback
        if get_ancestor_cells is not None:
            loaded = get_ancestor_cells(base_ver)
            if loaded is not None:
                base_cells = loaded
            else:
                logger.warning(
                    f"[Storage] Could not load base snapshot v{base_ver} for delta diff; "
                    "falling back to parent_cells (reconstruction may be inaccurate)."
                )
        elif version_number > 2:
            # No loader provided and we're not a direct child of the snapshot;
            # the fallback will produce an incorrect delta.
            logger.warning(
                f"[Storage] get_ancestor_cells not provided for v{version_number}; "
                f"delta will be diffed against parent (v{version_number - 1}) instead of "
                f"snapshot v{base_ver}. Reconstruction may be inaccurate."
            )

        delta = CellDelta.compute(
            parent_cells=base_cells,
            new_cells=cells,
            base_version_number=base_ver,
        )

        file_name = f"version_{version_number}.delta.json"
        abs_path = os.path.join(session_dir, file_name)

        with open(abs_path, "w", encoding="utf-8") as f:
            f.write(delta.model_dump_json(indent=2))

        checksum = self._compute_checksum(abs_path)
        delta_size = delta.delta_size_bytes
        rel_path = self._rel(abs_path)
        return rel_path, checksum, delta_size

    # ------------------------------------------------------------------
    # Load
    # ------------------------------------------------------------------

    def load_notebook(
        self,
        file_path: str,
        get_ancestor_cells: Optional[Callable[[int], Optional[NotebookCells]]] = None,
    ) -> NotebookCells:
        """
        Read a version file and return a complete NotebookCells.

        Handles both .ipynb (snapshot) and .delta.json (delta) transparently.

        Parameters
        ----------
        file_path         : path to version file (absolute or project-relative)
        get_ancestor_cells: callable(base_version_number) → NotebookCells | None
                            Required when loading a .delta.json to fetch the
                            base snapshot.  Injected by VersionService to avoid
                            circular imports.
        """
        abs_path = self._resolve_path(file_path)
        if not os.path.exists(abs_path):
            raise FileNotFoundError(f"Notebook version file not found: {abs_path}")

        if abs_path.endswith(".delta.json"):
            return self._load_delta(abs_path, get_ancestor_cells)
        else:
            return self._load_snapshot(abs_path)

    def _load_snapshot(self, abs_path: str) -> NotebookCells:
        """Read a full .ipynb and return NotebookCells."""
        with open(abs_path, "r", encoding="utf-8") as f:
            nb = nbformat.read(f, as_version=4)

        cells_dict: Dict[str, str] = {}
        for cell in nb.cells:
            cell_name = cell.metadata.get("cell_name")
            if cell_name:
                cells_dict[cell_name] = cell.source

        return NotebookCells.from_dict(cells_dict)

    def _load_delta(
        self,
        abs_path: str,
        get_ancestor_cells: Optional[Callable[[int], Optional[NotebookCells]]],
    ) -> NotebookCells:
        """
        Load a .delta.json, fetch the base snapshot via get_ancestor_cells,
        and apply the delta to reconstruct the full NotebookCells.
        """
        with open(abs_path, "r", encoding="utf-8") as f:
            raw = json.load(f)

        delta = CellDelta.model_validate(raw)

        if get_ancestor_cells is None:
            raise RuntimeError(
                f"Cannot reconstruct delta version at '{abs_path}': "
                "get_ancestor_cells callable was not provided."
            )

        base_cells = get_ancestor_cells(delta.base_version_number)
        if base_cells is None:
            raise RuntimeError(
                f"Base snapshot v{delta.base_version_number} not found; "
                "cannot reconstruct delta."
            )

        return delta.apply_to(base_cells)

    # ------------------------------------------------------------------
    # Active working document
    # ------------------------------------------------------------------

    def update_active_notebook(self, session_id: str, cells: NotebookCells) -> str:
        """
        Updates the main 'active.ipynb' file for the session.
        Patches existing cells to preserve outputs and manual markdown cells.
        Always writes a full .ipynb (never a delta).
        """
        session_dir = os.path.join(STORAGE_ROOT, f"session_{session_id}")
        os.makedirs(session_dir, exist_ok=True)
        abs_path = os.path.join(session_dir, "active.ipynb")
        cells_dict = cells.to_dict()

        if os.path.exists(abs_path):
            with open(abs_path, "r", encoding="utf-8") as f:
                nb = nbformat.read(f, as_version=4)

            updated_names: set = set()
            for cell in nb.cells:
                cell_name = cell.metadata.get("cell_name")
                if cell_name and cell_name in cells_dict:
                    cell.source = cells_dict[cell_name]
                    updated_names.add(cell_name)
                    cell.outputs = []
                    cell.execution_count = None

            # Append missing cells
            for cell_name in DEAP_CELL_ORDER:
                if cell_name in cells_dict and cell_name not in updated_names:
                    cc = new_code_cell(source=cells_dict[cell_name])
                    cc.metadata["cell_name"] = cell_name
                    nb.cells.append(cc)
            for cell_name, code in cells_dict.items():
                if cell_name not in DEAP_CELL_ORDER and cell_name not in updated_names:
                    cc = new_code_cell(source=code)
                    cc.metadata["cell_name"] = cell_name
                    nb.cells.append(cc)
        else:
            nb = new_notebook()
            ordered = []
            for cell_name in DEAP_CELL_ORDER:
                code = cells_dict.get(cell_name, "")
                if code:
                    cc = new_code_cell(source=code)
                    cc.metadata["cell_name"] = cell_name
                    ordered.append(cc)
            for cell_name, code in cells_dict.items():
                if cell_name not in DEAP_CELL_ORDER and code:
                    cc = new_code_cell(source=code)
                    cc.metadata["cell_name"] = cell_name
                    ordered.append(cc)
            nb.cells = ordered

        nb.metadata["session_id"] = session_id

        with open(abs_path, "w", encoding="utf-8") as f:
            nbformat.write(nb, f)

        rel_path = self._rel(abs_path)
        logger.info(f"[Storage] Updated active working file: {rel_path}")
        return rel_path

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def checksum_matches(self, file_path: str, expected_checksum: str) -> bool:
        abs_path = self._resolve_path(file_path)
        if not os.path.exists(abs_path):
            return False
        return self._compute_checksum(abs_path) == expected_checksum

    def _compute_checksum(self, abs_path: str) -> str:
        sha256 = hashlib.sha256()
        with open(abs_path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                sha256.update(chunk)
        return sha256.hexdigest()

    def _resolve_path(self, file_path: str) -> str:
        if os.path.isabs(file_path):
            return file_path
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        return os.path.join(project_root, file_path)

    def _rel(self, abs_path: str) -> str:
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        return os.path.relpath(abs_path, start=project_root)

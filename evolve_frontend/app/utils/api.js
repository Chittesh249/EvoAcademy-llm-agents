/**
 * EvoAcademy API Client
 * All calls target NEXT_PUBLIC_V2_BACKEND_BASE_URL (your FastAPI backend).
 * Routes match the standardized /api/v1/* structure.
 */

const getBaseUrl = () => {
    if (typeof window !== "undefined") {
        return process.env.NEXT_PUBLIC_V2_BACKEND_BASE_URL ?? "http://localhost:8000";
    }
    return process.env.NEXT_PUBLIC_V2_BACKEND_BASE_URL ?? "http://localhost:8000";
};

/**
 * Core fetch wrapper — all EvoAcademy API calls go through here.
 */
export const authenticatedFetchV2 = async (url, options = {}) => {
    const base = getBaseUrl();
    const headers = {
        "Content-Type": "application/json",
        ...options.headers,
    };

    const response = await fetch(`${base}${url}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
        let errorMessage = `Request failed with status: ${response.status}`;
        try {
            const errorJson = await response.json();
            errorMessage = errorJson.detail || errorJson.message || errorMessage;
        } catch (_) {}
        throw new Error(errorMessage);
    }

    if (response.status === 204) return null;
    return response.json();
};

// Keep for legacy compatibility (not used in new pages)
export const authenticatedFetch = authenticatedFetchV2;

// ─────────────────────────────────────────────────────────────────────────────
// Typed API functions
// ─────────────────────────────────────────────────────────────────────────────

/** GET /health — Check backend connectivity */
export const checkHealth = () =>
    authenticatedFetchV2("/health");

/**
 * POST /api/v1/llm/generate
 * Generate a brand-new DEAP notebook from a natural-language prompt.
 * @param {string} sessionId
 * @param {string} prompt
 */
export const generateNotebook = (sessionId, prompt) =>
    authenticatedFetchV2("/api/v1/llm/generate", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId, prompt }),
    });

/**
 * POST /api/v1/llm/refine
 * Refine an existing notebook based on a follow-up request.
 * @param {string} sessionId
 * @param {string} userPrompt
 * @param {Object} currentCells  — all 12 DEAP cell strings
 */
export const refineNotebook = (sessionId, userPrompt, currentCells) =>
    authenticatedFetchV2("/api/v1/llm/refine", {
        method: "POST",
        body: JSON.stringify({
            session_id: sessionId,
            user_prompt: userPrompt,
            current_cells: currentCells,
        }),
    });

/**
 * POST /api/v1/llm/debug
 * Auto-fix a runtime traceback in the active notebook.
 * @param {string} sessionId
 * @param {string} tracebackMsg
 * @param {Object} currentCells
 */
export const debugNotebook = (sessionId, tracebackMsg, currentCells) =>
    authenticatedFetchV2("/api/v1/llm/debug", {
        method: "POST",
        body: JSON.stringify({
            session_id: sessionId,
            traceback_msg: tracebackMsg,
            current_cells: currentCells,
        }),
    });

/**
 * GET /api/v1/sessions/{sessionId}/history
 * Returns the full chronological version timeline.
 * @param {string} sessionId
 */
export const getHistory = (sessionId) =>
    authenticatedFetchV2(`/api/v1/sessions/${sessionId}/history`);

/**
 * POST /api/v1/sessions/{sessionId}/rollback
 * Rolls back the active state to a previous version.
 * @param {string} sessionId
 * @param {number} versionNumber
 */
export const rollbackVersion = (sessionId, versionNumber) =>
    authenticatedFetchV2(`/api/v1/sessions/${sessionId}/rollback`, {
        method: "POST",
        body: JSON.stringify({ version_number: versionNumber }),
    });

/**
 * GET /api/v1/sessions/{sessionId}/search?q=...
 * Semantic search over version history via ChromaDB.
 * @param {string} sessionId
 * @param {string} query
 * @param {number} n  — max results (default 5)
 */
export const searchVersions = (sessionId, query, n = 5) =>
    authenticatedFetchV2(
        `/api/v1/sessions/${sessionId}/search?q=${encodeURIComponent(query)}&n=${n}`
    );

/**
 * POST /api/python/execute
 * Execute code on the FastAPI backend in an isolated subprocess.
 * @param {string} code
 * @param {string} sessionId
 */
export const executeBackendPython = (code, sessionId) =>
    authenticatedFetchV2("/api/python/execute", {
        method: "POST",
        body: JSON.stringify({ code, session_id: sessionId }),
    });


"use client";

import { useState, useCallback, useRef } from "react";
import { refineNotebook, debugNotebook } from "../../../utils/api";

const CELL_ORDER = [
    "imports", "config", "creator", "evaluation",
    "crossover", "mutation", "selection",
    "initialization", "toolbox", "main_algorithm", "stats", "visualization",
];

export function useSession(sessionId) {
    const [cells, setCells] = useState({});
    const [messages, setMessages] = useState([]); // { role, content, type }
    const [modifiedCells, setModifiedCells] = useState([]); // cell keys from last AI response
    const [versionInfo, setVersionInfo] = useState(null); // { versionNumber, versionId, targetProblem }
    const [llmLoading, setLlmLoading] = useState(false);
    const [error, setError] = useState(null);
    const abortRef = useRef(null);

    // Initialize cells from localStorage (set by landing page after /generate)
    function loadFromStorage() {
        try {
            const raw = localStorage.getItem(`evo_cells_${sessionId}`);
            const meta = localStorage.getItem(`evo_meta_${sessionId}`);
            if (raw) setCells(JSON.parse(raw));
            if (meta) setVersionInfo(JSON.parse(meta));
            return !!raw;
        } catch { return false; }
    }

    // Update a single cell value (user edit)
    const updateCell = useCallback((key, value) => {
        setCells(prev => ({ ...prev, [key]: value }));
    }, []);

    // Persist cells to localStorage whenever they change
    const persistCells = useCallback((newCells) => {
        setCells(newCells);
        try {
            localStorage.setItem(`evo_cells_${sessionId}`, JSON.stringify(newCells));
        } catch (_) {}
    }, [sessionId]);

    // Send a user message → call /api/v1/llm/refine
    const sendMessage = useCallback(async (userText) => {
        if (!userText.trim() || llmLoading) return;

        const userMsg = { role: "user", content: userText, type: "chat" };
        setMessages(prev => [...prev, userMsg]);
        setLlmLoading(true);
        setError(null);
        setModifiedCells([]);

        try {
            const res = await refineNotebook(sessionId, userText, cells);
            const newCells = res.cells;
            persistCells(newCells);
            setModifiedCells(res.cells_modified || []);
            setVersionInfo(prev => ({
                ...prev,
                versionNumber: res.version_number,
                versionId: res.version_id,
            }));
            setMessages(prev => [
                ...prev,
                {
                    role: "assistant",
                    content: res.tutor_explanation,
                    type: "refine",
                    cellsModified: res.cells_modified || [],
                    versionNumber: res.version_number,
                },
            ]);
        } catch (err) {
            setError(err.message);
            setMessages(prev => [
                ...prev,
                { role: "assistant", content: `⚠️ Error: ${err.message}`, type: "error" },
            ]);
        } finally {
            setLlmLoading(false);
        }
    }, [sessionId, cells, llmLoading, persistCells]);

    // Auto-debug — called when user pastes a traceback
    const debugCells = useCallback(async (tracebackMsg) => {
        if (!tracebackMsg.trim() || llmLoading) return;

        setMessages(prev => [
            ...prev,
            { role: "user", content: `🐛 Runtime error:\n\`\`\`\n${tracebackMsg}\n\`\`\``, type: "debug" },
        ]);
        setLlmLoading(true);
        setError(null);
        setModifiedCells([]);

        try {
            const res = await debugNotebook(sessionId, tracebackMsg, cells);
            persistCells(res.cells);
            setModifiedCells(res.cells_modified || []);
            setVersionInfo(prev => ({
                ...prev,
                versionNumber: res.version_number,
                versionId: res.version_id,
            }));
            setMessages(prev => [
                ...prev,
                {
                    role: "assistant",
                    content: res.tutor_explanation,
                    type: "debug",
                    cellsModified: res.cells_modified || [],
                    versionNumber: res.version_number,
                },
            ]);
        } catch (err) {
            setError(err.message);
            setMessages(prev => [
                ...prev,
                { role: "assistant", content: `⚠️ Debug failed: ${err.message}`, type: "error" },
            ]);
        } finally {
            setLlmLoading(false);
        }
    }, [sessionId, cells, llmLoading, persistCells]);

    // Apply rolled-back cells (called from useHistory)
    const applyRollback = useCallback((rolledCells, versionNum, versionId) => {
        persistCells(rolledCells);
        setVersionInfo(prev => ({ ...prev, versionNumber: versionNum, versionId }));
        setModifiedCells([]);
        setMessages(prev => [
            ...prev,
            {
                role: "assistant",
                content: `↩️ Rolled back to **version ${versionNum}**. All cells have been restored.`,
                type: "rollback",
            },
        ]);
    }, [persistCells]);

    return {
        cells,
        setCells,
        messages,
        modifiedCells,
        versionInfo,
        llmLoading,
        error,
        loadFromStorage,
        updateCell,
        sendMessage,
        debugCells,
        applyRollback,
        CELL_ORDER,
    };
}

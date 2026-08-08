"use client";

import { useState, useCallback } from "react";
import { getHistory, rollbackVersion, searchVersions } from "../../../utils/api";

export function useHistory(sessionId, applyRollback) {
    const [history, setHistory] = useState([]);
    const [searchResults, setSearchResults] = useState(null); // null = not searching
    const [searchQuery, setSearchQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [rollbackLoading, setRollbackLoading] = useState(null); // version_number being rolled back
    const [searchLoading, setSearchLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchHistory = useCallback(async () => {
        if (!sessionId) return;
        setLoading(true);
        setError(null);
        try {
            const data = await getHistory(sessionId);
            setHistory(data?.versions || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [sessionId]);

    const handleRollback = useCallback(async (versionNumber) => {
        if (!sessionId) return;
        setRollbackLoading(versionNumber);
        setError(null);
        try {
            const res = await rollbackVersion(sessionId, versionNumber);
            // Update the local history to reflect the new active version
            setHistory(prev =>
                prev.map(v => ({ ...v, is_active: v.version_number === versionNumber }))
            );
            // Apply the rolled-back cells to the editor
            if (res && res.cells) {
                applyRollback(res.cells, versionNumber, res.version_id || "");
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setRollbackLoading(null);
        }
    }, [sessionId, applyRollback]);

    const handleSearch = useCallback(async (query) => {
        if (!query.trim()) {
            setSearchResults(null);
            return;
        }
        setSearchLoading(true);
        setError(null);
        try {
            const results = await searchVersions(sessionId, query);
            setSearchResults(results?.results || []);
        } catch (err) {
            setError(err.message);
            setSearchResults([]);
        } finally {
            setSearchLoading(false);
        }
    }, [sessionId]);

    const clearSearch = useCallback(() => {
        setSearchResults(null);
        setSearchQuery("");
    }, []);

    return {
        history,
        searchResults,
        searchQuery,
        setSearchQuery,
        loading,
        rollbackLoading,
        searchLoading,
        error,
        fetchHistory,
        handleRollback,
        handleSearch,
        clearSearch,
    };
}

"use client";

import { useState } from "react";

const OP_STYLES = {
    generate: { label: "generate", cls: "badge-cyan" },
    refine:   { label: "refine",   cls: "badge-purple" },
    debug:    { label: "debug",    cls: "badge-red" },
    rollback: { label: "rollback", cls: "badge-gray" },
};

function VersionCard({ version, onRollback, rollbackLoading }) {
    const isActive = version.is_active;
    const op = OP_STYLES[version.operation_type] || { label: version.operation_type, cls: "badge-gray" };
    const isBusy = rollbackLoading === version.version_number;

    return (
        <div className="flex gap-0 p-0 relative" id={`version-${version.version_number}`}>
            {/* Timeline line */}
            <div className="flex flex-col items-center w-7 shrink-0 pt-3.5">
                <div className={`w-2.5 h-2.5 rounded-full bg-[#252533] border border-white/10 shrink-0 z-10 transition-all duration-200 ${
                    isActive ? "bg-[#7c3aed] border-[#a78bfa] shadow-[0_0_8px_rgba(124,58,237,0.35)]" : ""
                }`} />
                <div className="flex-1 w-[1px] bg-white/5 mt-1 min-h-[20px]" />
            </div>

            <div className={`flex-1 bg-[#18181f] border border-white/5 rounded-lg p-2.5 ml-1.5 my-1.5 flex flex-col gap-1.5 transition-colors duration-150 hover:border-white/10 ${
                isActive ? "border-[#7c3aed]/40 bg-[#7c3aed]/5" : ""
            }`}>
                <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`badge ${op.cls}`}>{op.label}</span>
                        <span className="text-[0.75rem] font-mono text-[#5a5a70] font-semibold">v{version.version_number}</span>
                        {isActive && <span className="badge badge-green text-[0.62rem]">active</span>}
                    </div>
                    {!isActive && (
                        <button
                            id={`btn-rollback-v${version.version_number}`}
                            className="btn btn-ghost btn-xs"
                            onClick={() => onRollback(version.version_number)}
                            disabled={rollbackLoading !== null}
                        >
                            {isBusy ? (
                                <div className="spinner !w-3 !h-3 !border" />
                            ) : (
                                "↩ Rollback"
                            )}
                        </button>
                    )}
                </div>

                {version.prompt && (
                    <p className="text-[0.78rem] text-[#f0f0f8] leading-relaxed break-all" title={version.prompt}>
                        {version.prompt.length > 80 ? version.prompt.slice(0, 80) + "…" : version.prompt}
                    </p>
                )}

                {version.summary && version.summary !== version.prompt && (
                    <p className="text-[0.75rem] text-[#5a5a70] leading-relaxed italic">{version.summary}</p>
                )}

                {version.cells_modified?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                        {version.cells_modified.map(c => (
                            <span key={c} className="badge badge-gray text-[0.65rem] px-1.5 py-0.5">{c}</span>
                        ))}
                    </div>
                )}

                <span className="text-[0.68rem] text-[#5a5a70] font-mono">
                    {new Date(version.created_at).toLocaleString()}
                </span>
            </div>
        </div>
    );
}

export default function HistoryPanel({
    history,
    searchResults,
    searchQuery,
    setSearchQuery,
    loading,
    rollbackLoading,
    searchLoading,
    error,
    onFetch,
    onRollback,
    onSearch,
    onClearSearch,
}) {
    const [searchInput, setSearchInput] = useState("");

    function handleSearchSubmit(e) {
        e.preventDefault();
        if (!searchInput.trim()) {
            onClearSearch();
            return;
        }
        onSearch(searchInput);
    }

    function handleSearchClear() {
        setSearchInput("");
        onClearSearch();
    }

    // Always ensure displayList is a proper array to avoid 'not iterable' errors
    const displayList = Array.isArray(searchResults) ? searchResults
        : Array.isArray(history) ? history
        : [];

    return (
        <div className="flex flex-col h-full bg-[#111118] overflow-hidden">
            {/* Header */}
            <div className="panel-header">
                <span className="panel-title">Version History</span>
                <button
                    id="btn-refresh-history"
                    className="btn btn-ghost btn-xs"
                    onClick={onFetch}
                    disabled={loading}
                    data-tooltip="Refresh"
                >
                    {loading ? (
                        <div className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} />
                    ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                        </svg>
                    )}
                </button>
            </div>

            {/* Semantic Search */}
            <div className="p-2.5 border-b border-white/5 bg-[#0a0a0f] flex flex-col gap-1.5 shrink-0">
                <form onSubmit={handleSearchSubmit} className="flex gap-1.5 items-center">
                    <div className="flex-1 flex items-center gap-1.5 bg-[#18181f] border border-white/5 rounded-lg px-2.5 transition-all duration-155 focus-within:border-[#7c3aed]/50 focus-within:ring-1 focus-within:ring-[#7c3aed]/35">
                        <svg className="text-[#5a5a70] shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                        <input
                            id="input-version-search"
                            type="text"
                            placeholder="Search versions… (e.g. 'added elitism')"
                            value={searchInput}
                            onChange={e => setSearchInput(e.target.value)}
                            className="flex-1 bg-transparent border-none outline-none py-2 text-[0.8rem] font-inherit text-[#f0f0f8] placeholder-[#5a5a70]"
                        />
                        {searchInput && (
                            <button type="button" className="bg-transparent border-none cursor-pointer text-[#5a5a70] text-[0.75rem] px-1 py-0.5 rounded hover:text-[#f0f0f8] transition-colors duration-150 font-inherit" onClick={handleSearchClear}>✕</button>
                        )}
                    </div>
                    <button
                        id="btn-search-versions"
                        type="submit"
                        className="btn btn-ghost btn-xs"
                        disabled={searchLoading || !searchInput.trim()}
                    >
                        {searchLoading ? (
                            <div className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                        ) : "Search"}
                    </button>
                </form>

                {searchResults !== null && (
                    <div className="flex items-center justify-between px-1 py-0.5 text-[0.72rem] text-[#5a5a70]">
                        <span>{searchResults.length} result{searchResults.length !== 1 ? "s" : ""}</span>
                        <button className="bg-transparent border-none cursor-pointer text-[#5a5a70] text-[0.75rem] px-1 py-0.5 rounded hover:text-[#f0f0f8] transition-colors duration-150 font-inherit" onClick={handleSearchClear}>Clear</button>
                    </div>
                )}
            </div>

            {error && (
                <div className="m-2 p-2.5 bg-[#ef4444]/5 border border-[#ef4444]/25 rounded-lg text-[0.8rem] text-[#ef4444]">{error}</div>
            )}

            {/* Version list */}
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0">
                {loading && history.length === 0 ? (
                    <div className="flex flex-col gap-2">
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="skeleton h-[80px] rounded-lg" />
                        ))}
                    </div>
                ) : displayList.length === 0 ? (
                    <div className="py-10 px-4 text-center text-[#5a5a70] text-[0.825rem]">
                        {searchResults !== null
                            ? "No versions match your search"
                            : "No versions yet — generate a notebook first"}
                    </div>
                ) : (
                    [...displayList]
                        .sort((a, b) => b.version_number - a.version_number)
                        .map(v => (
                            <VersionCard
                                key={v.version_number}
                                version={v}
                                onRollback={onRollback}
                                rollbackLoading={rollbackLoading}
                            />
                        ))
                )}
            </div>
        </div>
    );
}

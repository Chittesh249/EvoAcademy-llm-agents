"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "./_hooks/useSession";
import { useHistory } from "./_hooks/useHistory";
import { usePyodide } from "./_hooks/usePyodide";
import CodeCellPanel from "./_components/CodeCellPanel";
import ChatPanel from "./_components/ChatPanel";
import HistoryPanel from "./_components/HistoryPanel";

export default function SessionPage({ params }) {
    const { sessionId } = use(params);
    const router = useRouter();

    // Sidebar states: null | "chat" | "history"
    const [sidebarPanel, setSidebarPanel] = useState("chat"); // Default to chat open

    const {
        cells, versionInfo, messages, modifiedCells,
        llmLoading, error: sessionError,
        loadFromStorage, updateCell, sendMessage, debugCells, applyRollback,
        CELL_ORDER,
    } = useSession(sessionId);

    const {
        history, searchResults, searchQuery, setSearchQuery,
        loading: historyLoading, rollbackLoading, searchLoading, error: historyError,
        fetchHistory, handleRollback, handleSearch, clearSearch,
    } = useHistory(sessionId, applyRollback);

    const {
        pyodideReady,
        loadingStatus: pyodideLoadingStatus,
        statusText: pyodideStatusText,
        runPython,
    } = usePyodide();

    useEffect(() => {
        if (!sessionId) return;
        loadFromStorage();
        fetchHistory();
    }, [sessionId]); // eslint-disable-line

    // After refine/debug, refresh history to show new version
    useEffect(() => {
        if (!llmLoading && messages.length > 0) {
            fetchHistory();
        }
    }, [llmLoading]); // eslint-disable-line

    function toggleSidebar(panelName) {
        if (sidebarPanel === panelName) {
            setSidebarPanel(null); // Collapse drawer
        } else {
            setSidebarPanel(panelName); // Switch panel
        }
    }

    // Capture cell errors and direct them to the AI Tutor debug pipeline
    function handleDebugCall(tracebackMsg) {
        // Open the chat panel so the user sees the debug conversation
        setSidebarPanel("chat");
        debugCells(tracebackMsg);
    }

    const versionBadge = versionInfo?.versionNumber
        ? `v${versionInfo.versionNumber}`
        : null;

    return (
        <div className="h-screen flex flex-col overflow-hidden bg-[#050507]">
            {/* ── Top Header ── */}
            <header className="flex items-center justify-between px-4 h-[52px] border-b border-white/5 bg-[#0a0a0f] flex-shrink-0 gap-3 z-20">
                <div className="flex items-center gap-3 min-w-0">
                    <button
                        id="btn-home"
                        className="btn btn-ghost btn-sm"
                        onClick={() => router.push("/")}
                    >
                        ← Home
                    </button>
                    <div className="flex flex-col min-w-0">
                        <span className="text-[0.85rem] font-semibold text-[#f0f0f8] truncate max-w-[200px] sm:max-w-[400px]">
                            {versionInfo?.targetProblem
                                ? versionInfo.targetProblem
                                : "EvoAcademy Session"}
                        </span>
                        <span className="text-[0.68rem] font-mono text-[#5a5a70]">
                            {sessionId.slice(0, 8)}…
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-2.5 min-w-0">
                    {versionBadge && (
                        <span className="badge badge-cyan">{versionBadge}</span>
                    )}
                    {llmLoading && (
                        <div className="flex items-center gap-1.5 text-[0.78rem] text-[#a78bfa] animate-pulse">
                            <div className="spinner !w-3 !h-3 !border" />
                            AI working…
                        </div>
                    )}
                </div>
            </header>

            {/* ── Main Layout ── */}
            <div className="flex-1 flex overflow-hidden min-h-0 relative">
                {/* 1. Main Workspace: Jupyter Notebook */}
                <div className="flex-1 h-full flex flex-col overflow-hidden">
                    <CodeCellPanel
                        cells={cells}
                        modifiedCells={modifiedCells}
                        onCellChange={updateCell}
                        cellOrder={CELL_ORDER}
                        runPython={runPython}
                        pyodideReady={pyodideReady}
                        pyodideStatus={pyodideStatusText}
                        onDebugCall={handleDebugCall}
                        sessionId={sessionId}
                    />
                </div>

                {/* 2. Slide-out Drawer Panel */}
                <div
                    className={`h-full border-l border-white/5 bg-[#111118] flex flex-col overflow-hidden transition-all duration-300 ease-in-out z-10 ${
                        sidebarPanel ? "w-full md:w-[380px] opacity-100" : "w-0 opacity-0 pointer-events-none"
                    }`}
                >
                    {sidebarPanel === "chat" && (
                        <ChatPanel
                            messages={messages}
                            llmLoading={llmLoading}
                            onSend={sendMessage}
                            onDebug={debugCells}
                        />
                    )}
                    {sidebarPanel === "history" && (
                        <HistoryPanel
                            history={history}
                            searchResults={searchResults}
                            searchQuery={searchQuery}
                            setSearchQuery={setSearchQuery}
                            loading={historyLoading}
                            rollbackLoading={rollbackLoading}
                            searchLoading={searchLoading}
                            error={historyError}
                            onFetch={fetchHistory}
                            onRollback={handleRollback}
                            onSearch={handleSearch}
                            onClearSearch={clearSearch}
                        />
                    )}
                </div>

                {/* 3. Slim Right Sidebar (Toggle Buttons) */}
                <div className="w-[56px] h-full bg-[#0a0a0f] border-l border-white/5 flex flex-col items-center py-4 gap-4 z-20">
                    <button
                        id="sidebar-btn-chat"
                        className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg hover:bg-[#18181f] hover:text-[#a78bfa] transition-all duration-200 ${
                            sidebarPanel === "chat" ? "bg-[#7c3aed]/10 border border-[#7c3aed]/30 text-[#a78bfa]" : "text-[#5a5a70]"
                        }`}
                        onClick={() => toggleSidebar("chat")}
                        title="AI Tutor Chat"
                    >
                        🤖
                    </button>
                    <button
                        id="sidebar-btn-history"
                        className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg hover:bg-[#18181f] hover:text-[#a78bfa] transition-all duration-200 ${
                            sidebarPanel === "history" ? "bg-[#7c3aed]/10 border border-[#7c3aed]/30 text-[#a78bfa]" : "text-[#5a5a70]"
                        }`}
                        onClick={() => toggleSidebar("history")}
                        title="Version History"
                    >
                        🕒
                    </button>
                </div>
            </div>
        </div>
    );
}

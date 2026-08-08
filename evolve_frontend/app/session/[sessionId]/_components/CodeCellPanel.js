"use client";

import { useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { executeBackendPython } from "../../../utils/api";

const CELL_META = {
    imports:       { label: "Imports",         icon: "📦", desc: "Library imports" },
    config:        { label: "Config",           icon: "⚙️", desc: "Hyperparameters" },
    creator:       { label: "Creator",          icon: "🧬", desc: "Fitness & Individual" },
    evaluation:    { label: "Evaluation",       icon: "🎯", desc: "Fitness function" },
    crossover:     { label: "Crossover",        icon: "✂️", desc: "Mating operator" },
    mutation:      { label: "Mutation",         icon: "🔀", desc: "Mutation operator" },
    selection:     { label: "Selection",        icon: "🏆", desc: "Selection strategy" },
    initialization:{ label: "Initialization",  icon: "🌱", desc: "Population init" },
    toolbox:       { label: "Toolbox",          icon: "🔧", desc: "DEAP toolbox setup" },
    main_algorithm:{ label: "Main Algorithm",   icon: "🚀", desc: "Evolution loop" },
    stats:         { label: "Statistics",       icon: "📊", desc: "Stats tracking" },
    visualization: { label: "Visualization",   icon: "📈", desc: "Result plots" },
};

function shouldRunOnBackend(code) {
    const lines = code.split("\n");
    const cleanedLines = lines.map(line => {
        if (line.trim().startsWith("#")) return "";
        return line;
    });
    // Matches "import deap", "from deap import ...", etc.
    const importRegex = /^\s*(import\s+[^#\n]*\b(deap|moocore)\b|from\s+\b(deap|moocore)\b)/;
    for (const line of cleanedLines) {
        if (importRegex.test(line)) {
            return true;
        }
    }
    return false;
}

function CodeCell({
    cellKey,
    value,
    onChange,
    isModified,
    isRunning,
    executionCount,
    outputs,
    onRun,
    onDebugTrigger,
    pyodideReady,
}) {
    const meta = CELL_META[cellKey] || { label: cellKey, icon: "📄", desc: "" };

    return (
        <div
            className={`bg-[#0a0a0f] border border-white/5 rounded-lg overflow-hidden transition-all duration-200 ${
                isModified ? "border-[#7c3aed]/40 shadow-[0_0_12px_rgba(124,58,237,0.1)]" : ""
            }`}
            id={`cell-${cellKey}`}
        >
            {/* Cell Header / Meta info */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-[#111118]">
                <div className="flex items-center gap-2">
                    <span className="text-sm shrink-0">{meta.icon}</span>
                    <span className={`text-[0.78rem] font-bold tracking-wide uppercase ${isModified ? "text-[#a78bfa]" : "text-[#5a5a70]"}`}>
                        {meta.label}
                    </span>
                    <span className="text-[0.7rem] text-[#5a5a70] hidden sm:inline">— {meta.desc}</span>
                </div>
                <div className="flex items-center gap-2">
                    {isModified && (
                        <span className="badge badge-purple text-[0.62rem] px-2 py-0.5 animate-pulse">
                            Modified
                        </span>
                    )}
                    <button
                        className="btn btn-ghost btn-xs flex items-center gap-1 hover:border-[#7c3aed]"
                        onClick={onRun}
                        disabled={isRunning}
                        title="Run this cell"
                    >
                        {isRunning ? (
                            <div className="spinner !w-3 !h-3 !border" />
                        ) : (
                            <>
                                <span className="text-[0.65rem]">▶ Run</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Notebook Cell Input Box */}
            <div className="flex bg-[#050507]/90 min-h-[80px]">
                {/* Prompt signifier e.g. In [1]: */}
                <div className="w-[64px] flex-shrink-0 flex items-start justify-end pr-2 pt-3 select-none text-[0.72rem] font-mono text-[#5a5a70]">
                    {isRunning ? (
                        <span className="text-[#a78bfa] animate-pulse">In [*]:</span>
                    ) : executionCount !== null ? (
                        <span>In [{executionCount}]:</span>
                    ) : (
                        <span>In [ ]:</span>
                    )}
                </div>

                <div className="flex-1 border-l border-white/5 bg-[#050507]/40">
                    <CodeMirror
                        value={value || ""}
                        height="auto"
                        extensions={[python()]}
                        theme="dark"
                        onChange={(val) => onChange(cellKey, val)}
                        className="text-xs md:text-sm font-mono"
                        basicSetup={{
                            lineNumbers: true,
                            foldGutter: true,
                            dropCursor: true,
                            allowMultipleSelections: false,
                            indentOnInput: true,
                            syntaxHighlighting: true,
                            highlightActiveLine: false,
                            highlightSelectionMatches: false,
                        }}
                    />
                </div>
            </div>

            {/* Notebook Cell Output Box */}
            {(outputs || isRunning) && (
                <div className="flex border-t border-white/5 bg-[#0a0a0f] text-xs font-mono relative">
                    {/* Out [x]: label */}
                    <div className="w-[64px] flex-shrink-0 flex items-start justify-end pr-2 pt-3 select-none text-[0.72rem] text-[#5a5a70]">
                        {outputs?.plot ? "Out [*]:" : ""}
                    </div>

                    {/* Output area */}
                    <div className="flex-1 p-3 text-[#9898b0] leading-relaxed whitespace-pre-wrap select-text overflow-x-auto relative">
                        {outputs?.execution_mode && (
                            <span className="absolute top-2 right-2 text-[0.62rem] text-[#5a5a70] uppercase tracking-wider bg-[#18181f] border border-white/5 px-2 py-0.5 rounded">
                                {outputs.execution_mode}
                            </span>
                        )}

                        {isRunning && (
                            <div className="text-[#5a5a70] italic">Running code...</div>
                        )}

                        {/* Standard Output */}
                        {outputs?.stdout && (
                            <div className="text-[#f0f0f8]">{outputs.stdout}</div>
                        )}

                        {/* Standard Error (Traceback) */}
                        {outputs?.stderr && (
                            <div className="flex flex-col gap-2">
                                <div className="text-[#ef4444] bg-[#ef4444]/5 p-2 rounded border border-[#ef4444]/20">
                                    {outputs.stderr}
                                </div>
                                <button
                                    className="btn btn-ghost btn-xs !text-[#ef4444] border-[#ef4444]/30 hover:bg-[#ef4444]/10 self-start"
                                    onClick={() => onDebugTrigger(outputs.stderr)}
                                >
                                    🤖 Auto-Fix Traceback with AI Tutor
                                </button>
                            </div>
                        )}

                        {/* Intercepted Matplotlib Plot */}
                        {outputs?.plot && (
                            <div className="mt-2 bg-white rounded-lg p-2 max-w-[500px]">
                                <img
                                    src={`data:image/png;base64,${outputs.plot}`}
                                    alt="Cell plot output"
                                    className="w-full h-auto"
                                />
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function CodeCellPanel({
    cells,
    modifiedCells,
    onCellChange,
    cellOrder,
    runPython,
    pyodideReady,
    pyodideStatus,
    onDebugCall,
    sessionId,
}) {
    const [cellStates, setCellStates] = useState({});
    const [globalRunCount, setGlobalRunCount] = useState(1);
    const [execMode, setExecMode] = useState("auto"); // "auto" | "browser" | "backend"

    async function handleRunCell(key) {
        setCellStates(prev => ({
            ...prev,
            [key]: { ...prev[key], isRunning: true },
        }));

        const code = cells[key] || "";
        
        let useBackend = false;
        if (execMode === "backend") {
            useBackend = true;
        } else if (execMode === "browser") {
            useBackend = false;
        } else {
            // Auto mode
            useBackend = shouldRunOnBackend(code);
        }

        const modeLabel = useBackend ? "backend" : "browser";
        console.log(`[Python] Execution mode: ${modeLabel}`);

        try {
            let result;
            if (useBackend) {
                console.log(`[Python] Backend execution started (session_id=${sessionId})`);
                const startTime = Date.now();
                const res = await executeBackendPython(code, sessionId);
                const elapsed = (Date.now() - startTime) / 1000;
                console.log(`[Python] Backend execution completed in ${elapsed.toFixed(2)}s`);
                
                result = {
                    stdout: res.stdout || "",
                    stderr: res.stderr || "",
                    plot: res.plot || null,
                    has_error: res.has_error || false,
                    execution_time: res.execution_time ?? elapsed,
                    execution_mode: "backend",
                };
            } else {
                if (!pyodideReady || !runPython) {
                    throw new Error("Browser Python runtime is not ready yet.");
                }
                const startTime = Date.now();
                const res = await runPython(code);
                const elapsed = (Date.now() - startTime) / 1000;
                
                result = {
                    stdout: res.stdout || "",
                    stderr: res.stderr || "",
                    plot: res.plot || null,
                    has_error: res.has_error || false,
                    execution_time: elapsed,
                    execution_mode: "browser",
                };
            }

            const currentCount = globalRunCount;
            setGlobalRunCount(c => c + 1);

            setCellStates(prev => ({
                ...prev,
                [key]: {
                    isRunning: false,
                    executionCount: currentCount,
                    outputs: result,
                },
            }));
        } catch (err) {
            setCellStates(prev => ({
                ...prev,
                [key]: {
                    isRunning: false,
                    executionCount: null,
                    outputs: {
                        stdout: "",
                        stderr: err.message,
                        plot: null,
                        has_error: true,
                        execution_mode: useBackend ? "backend" : "browser",
                    },
                },
            }));
        }
    }

    async function handleRunAll() {
        for (const key of cellOrder) {
            if (cells[key] !== undefined) {
                await handleRunCell(key);
            }
        }
    }

    function copyAll() {
        const allCode = cellOrder
            .map(k => `# ── ${CELL_META[k]?.label || k} ──\n${cells[k] || ""}`)
            .join("\n\n");
        navigator.clipboard.writeText(allCode).catch(() => {});
    }

    const modifiedSet = new Set(modifiedCells);

    return (
        <div className="flex flex-col h-full bg-[#050507] overflow-hidden">
            {/* Environment Status & Controls */}
            <div className="flex items-center justify-between px-4 py-2 bg-[#0a0a0f] border-b border-white/5 shrink-0 text-[0.72rem]">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                        <span className={`status-dot ${pyodideReady ? "online animate-none" : "loading animate-pulse"}`} />
                        <span className={pyodideReady ? "text-[#10b981]" : "text-[#f59e0b]"}>
                            {pyodideStatus}
                        </span>
                    </div>
                    {/* Execution mode selector toggle */}
                    <select
                        value={execMode}
                        onChange={(e) => setExecMode(e.target.value)}
                        className="bg-[#18181f] border border-white/5 text-[0.72rem] text-[#9898b0] rounded px-2 py-0.5 outline-none cursor-pointer hover:border-[#7c3aed] transition-all"
                    >
                        <option value="auto">Execution Mode: Auto</option>
                        <option value="browser">Execution Mode: Browser Only</option>
                        <option value="backend">Execution Mode: Backend Only</option>
                    </select>
                </div>
                <div className="flex gap-2">
                    <button
                        id="btn-copy-all"
                        className="btn btn-ghost btn-xs flex items-center gap-1.5"
                        onClick={copyAll}
                    >
                        Copy All Script
                    </button>
                    <button
                        id="btn-run-all"
                        className="btn btn-ghost btn-xs !text-[#a78bfa] border-[#7c3aed]/30 hover:bg-[#7c3aed]/10"
                        onClick={handleRunAll}
                    >
                        ▶ Run All Cells
                    </button>
                </div>
            </div>

            {/* Sequential Jupyter Cell List */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                {Object.keys(cells).length === 0 ? (
                    <div className="flex flex-col items-center justify-center flex-1 text-center py-20 text-[#5a5a70] text-sm">
                        <div className="text-3xl mb-2">🧬</div>
                        <p>Enter a prompt on the landing page to load the DEAP notebook cells.</p>
                    </div>
                ) : (
                    cellOrder.map(key => {
                        if (cells[key] === undefined) return null;
                        const state = cellStates[key] || { isRunning: false, executionCount: null, outputs: null };
                        return (
                            <CodeCell
                                key={key}
                                cellKey={key}
                                value={cells[key]}
                                onChange={onCellChange}
                                isModified={modifiedSet.has(key)}
                                isRunning={state.isRunning}
                                executionCount={state.executionCount}
                                outputs={state.outputs}
                                onRun={() => handleRunCell(key)}
                                onDebugTrigger={onDebugCall}
                                pyodideReady={pyodideReady}
                            />
                        );
                    })
                )}
            </div>
        </div>
    );
}

"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { generateNotebook, checkHealth } from "./utils/api";

const CELL_KEYS = [
    "imports", "config", "creator", "evaluation",
    "crossover", "mutation", "selection",
    "initialization", "toolbox", "main_algorithm", "stats", "visualization",
];

function getOrCreateSessionId() {
    if (typeof window === "undefined") return "";
    let id = localStorage.getItem("evo_session_id");
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem("evo_session_id", id);
    }
    return id;
}

const EXAMPLE_PROMPTS = [
    "Solve the Traveling Salesman Problem using a genetic algorithm with tournament selection",
    "Optimize the Rastrigin function with a real-valued genetic algorithm using SBX crossover",
    "Evolve a neural network topology for the XOR problem using NEAT-style crossover",
    "Implement a multi-objective genetic algorithm for the Knapsack problem",
    "Use PSO-inspired mutation to solve the one-max binary string optimization problem",
];

export default function LandingPage() {
    const router = useRouter();
    const [prompt, setPrompt] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [backendOk, setBackendOk] = useState(null);
    const [sessionId, setSessionId] = useState("");
    const [exampleIdx, setExampleIdx] = useState(0);
    const textareaRef = useRef(null);

    useEffect(() => {
        setSessionId(getOrCreateSessionId());
        checkHealth()
            .then(() => setBackendOk(true))
            .catch(() => setBackendOk(false));

        // Cycle example prompts
        const interval = setInterval(() => {
            setExampleIdx(i => (i + 1) % EXAMPLE_PROMPTS.length);
        }, 4000);
        return () => clearInterval(interval);
    }, []);

    async function handleGenerate(e) {
        e.preventDefault();
        const trimmed = prompt.trim();
        if (!trimmed) return;

        setLoading(true);
        setError(null);
        try {
            const result = await generateNotebook(sessionId, trimmed);
            // Store cells so session page doesn't need to re-generate
            localStorage.setItem(`evo_cells_${sessionId}`, JSON.stringify(result.cells));
            localStorage.setItem(`evo_meta_${sessionId}`, JSON.stringify({
                targetProblem: result.target_problem,
                versionNumber: result.version_number,
                versionId: result.version_id,
                prompt: trimmed,
            }));
            router.push(`/session/${sessionId}`);
        } catch (err) {
            setError(err.message);
            setLoading(false);
        }
    }

    function handleNewSession() {
        const newId = crypto.randomUUID();
        localStorage.setItem("evo_session_id", newId);
        setSessionId(newId);
        setPrompt("");
        setError(null);
    }

    function handleKeyDown(e) {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            handleGenerate(e);
        }
    }

    return (
        <main className="min-h-screen flex flex-col relative overflow-hidden bg-[#050507]">
            {/* Background blobs */}
            <div className="fixed w-[600px] h-[600px] -top-[200px] -left-[100px] rounded-full blur-[80px] pointer-events-none z-0 bg-[radial-gradient(circle,rgba(124,58,237,0.15)_0%,transparent_70%)] animate-[pulse_8s_infinite]" aria-hidden />
            <div className="fixed w-[500px] h-[500px] -bottom-[100px] -right-[50px] rounded-full blur-[80px] pointer-events-none z-0 bg-[radial-gradient(circle,rgba(6,182,212,0.1)_0%,transparent_70%)] animate-[pulse_10s_infinite]" aria-hidden />
            <div className="fixed w-[400px] h-[400px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full blur-[80px] pointer-events-none z-0 bg-[radial-gradient(circle,rgba(124,58,237,0.06)_0%,transparent_70%)]" aria-hidden />

            {/* Header */}
            <header className="relative z-10 flex items-center justify-between px-6 md:px-10 py-5 border-b border-white/5 bg-[#050507]/60 backdrop-blur-md">
                <div className="flex items-center gap-2">
                    <span className="text-xl shadow-[0_0_12px_var(--accent)]">⚡</span>
                    <span className="text-lg font-bold bg-gradient-to-r from-[#f0f0f8] to-[#a78bfa] bg-clip-text text-transparent tracking-tight">
                        EvoAcademy
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    {backendOk !== null && (
                        <div className={`flex items-center gap-1.5 px-3 py-1.2 rounded-full text-xs font-medium border ${backendOk ? "text-[#10b981] border-[#10b981]/30" : "text-[#ef4444] border-[#ef4444]/30"} bg-[#111118]`}>
                            <span className={`status-dot ${backendOk ? "online" : "offline"}`} />
                            {backendOk ? "Backend connected" : "Backend offline"}
                        </div>
                    )}
                    {sessionId && (
                        <button
                            id="btn-continue-session"
                            className="btn btn-ghost btn-sm"
                            onClick={() => router.push(`/session/${sessionId}`)}
                        >
                            Continue session →
                        </button>
                    )}
                </div>
            </header>

            {/* Hero */}
            <section className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-10 max-w-[800px] mx-auto w-full gap-6">
                <div className="flex gap-2 flex-wrap justify-center animate-fade-in">
                    <span className="badge badge-purple">AI-Powered</span>
                    <span className="badge badge-cyan">DEAP Notebooks</span>
                    <span className="badge badge-green">Version History</span>
                </div>

                <h1 className="text-4xl md:text-6xl font-extrabold text-center leading-none tracking-tight animate-fade-in">
                    Learn Evolutionary<br />
                    <span className="bg-gradient-to-r from-[#a78bfa] to-[#06b6d4] bg-clip-text text-transparent">
                        Algorithms by Building
                    </span>
                </h1>

                <p className="text-center text-[1.05rem] leading-relaxed text-[#9898b0] max-w-[560px] animate-fade-in">
                    Describe an optimization problem in plain English. EvoAcademy generates
                    a complete DEAP genetic algorithm notebook, explains every component,
                    and lets you iterate with a built-in AI tutor.
                </p>

                {/* Prompt Form */}
                <form className="w-full flex flex-col gap-3 animate-fade-in" onSubmit={handleGenerate} id="form-generate">
                    <div className="bg-[#111118] border border-white/10 rounded-3xl overflow-hidden transition-all duration-200 focus-within:border-[#7c3aed]/50 focus-within:ring-2 focus-within:ring-[#7c3aed]/35 shadow-2xl">
                        <div className="flex items-center justify-between px-[18px] pt-[14px]">
                            <span className="text-[0.78rem] font-semibold text-[#5a5a70] tracking-wider uppercase">
                                Your optimization problem
                            </span>
                            <span className="text-[0.72rem] font-mono text-[#5a5a70] bg-[#1e1e28] px-2 py-0.5 rounded border border-white/5" title={sessionId}>
                                Session: {sessionId.slice(0, 8)}…
                            </span>
                        </div>
                        <textarea
                            ref={textareaRef}
                            id="input-prompt"
                            className="w-full bg-transparent border-none outline-none resize-none px-[18px] py-[14px] text-base font-sans text-[#f0f0f8] placeholder-[#5a5a70] leading-relaxed"
                            placeholder={EXAMPLE_PROMPTS[exampleIdx]}
                            value={prompt}
                            onChange={e => setPrompt(e.target.value)}
                            onKeyDown={handleKeyDown}
                            rows={4}
                            disabled={loading}
                        />
                        <div className="flex items-center justify-between px-[18px] py-[12px] border-t border-white/5 bg-[#0a0a0f]">
                            <span className="text-[0.75rem] text-[#5a5a70]">⌘ + Enter to generate</span>
                            <button
                                id="btn-generate"
                                type="submit"
                                className="btn btn-primary"
                                disabled={loading || !prompt.trim() || backendOk === false}
                            >
                                {loading ? (
                                    <>
                                        <div className="spinner" />
                                        Generating…
                                    </>
                                ) : (
                                    <>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                            <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                                        </svg>
                                        Generate Notebook
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/30 text-[#ef4444] text-sm" role="alert">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            {error}
                        </div>
                    )}
                </form>

                {/* Feature grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full animate-fade-in">
                    {[
                        { icon: "🧬", title: "12 DEAP Blocks", desc: "Imports, config, creator, eval, crossover, mutation, selection, toolbox, algorithm, stats & more" },
                        { icon: "🤖", title: "AI Tutor Chat", desc: "Ask follow-up questions or request code changes. The tutor explains every modification" },
                        { icon: "🕒", title: "Git-like History", desc: "Every generation and refinement creates an immutable version. Roll back instantly" },
                        { icon: "🔍", title: "Semantic Search", desc: "Find past versions with natural language queries powered by ChromaDB embeddings" },
                    ].map(f => (
                        <div key={f.title} className="bg-[#111118] border border-white/5 rounded-2xl p-[18px] transition-all duration-200 hover:border-white/10 hover:bg-[#18181f] hover:-translate-y-0.5 hover:shadow-2xl">
                            <div className="text-2xl mb-2">{f.icon}</div>
                            <h3 className="text-[0.9rem] font-bold mb-1">{f.title}</h3>
                            <p className="text-[0.8rem] leading-normal text-[#5a5a70]">{f.desc}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Footer */}
            <footer className="relative z-10 flex items-center justify-center gap-4 p-5 border-t border-white/5">
                <button id="btn-new-session" className="btn btn-ghost btn-sm" onClick={handleNewSession}>
                    + Start fresh session
                </button>
                <span className="text-[0.78rem] text-[#5a5a70]">
                    Powered by DEAP · Built with EvoAcademy API v2.0
                </span>
            </footer>
        </main>
    );
}
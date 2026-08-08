"use client";

import { useState, useRef, useEffect } from "react";

function detectTraceback(text) {
    return (
        text.includes("Traceback (most recent call last)") ||
        text.includes("Error:") ||
        /^\s+File ".+", line \d+/m.test(text)
    );
}

function MessageBubble({ msg }) {
    const isUser = msg.role === "user";
    const isError = msg.type === "error";

    return (
        <div className={`flex gap-2.5 animate-[fadeIn_0.2s_ease] ${isUser ? "flex-row-reverse" : "flex-row items-start"}`}>
            {!isUser && (
                <div className="w-[30px] h-[30px] rounded-full bg-gradient-to-br from-[#7c3aed] to-[#5b21b6] flex items-center justify-center text-[0.9rem] shrink-0 shadow-[0_0_10px_rgba(124,58,237,0.35)]">
                    ⚡
                </div>
            )}
            <div className={`max-w-[85%] flex flex-col gap-1.5 ${isUser ? "items-end" : "items-start"}`}>
                {msg.cellsModified?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                        {msg.cellsModified.map(c => (
                            <span key={c} className="badge badge-purple text-[0.68rem] px-2 py-0.5">{c}</span>
                        ))}
                    </div>
                )}
                {msg.versionNumber && (
                    <div className="flex">
                        <span className="badge badge-cyan">v{msg.versionNumber}</span>
                    </div>
                )}
                <div
                    className={`prose bg-[#18181f] border border-white/5 p-3 text-sm ${
                        isUser
                            ? "bg-gradient-to-br from-[#7c3aed]/25 to-[#7c3aed]/15 border-[#7c3aed]/40 rounded-l-xl rounded-tr-xl rounded-br-sm"
                            : "rounded-r-xl rounded-bl-xl rounded-tl-sm"
                    } ${isError ? "bg-[#ef4444]/10 border-[#ef4444]/35" : ""}`}
                    dangerouslySetInnerHTML={{
                        __html: formatMessage(msg.content),
                    }}
                />
            </div>
        </div>
    );
}

function formatMessage(text) {
    if (!text) return "";
    // Simple markdown-to-HTML conversion
    return text
        .replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) =>
            `<pre><code class="language-${lang || "python"}">${escapeHtml(code.trim())}</code></pre>`
        )
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/↩️ Rolled back to \*\*(.+?)\*\*/g, "↩️ Rolled back to <strong>$1</strong>")
        .replace(/^### (.+)$/gm, "<h3>$1</h3>")
        .replace(/^## (.+)$/gm, "<h3>$1</h3>")
        .replace(/\n\n/g, "</p><p>")
        .replace(/^(?!<[ph3])/gm, "")
        .replace(/^/, "<p>")
        .concat("</p>");
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export default function ChatPanel({ messages, llmLoading, onSend, onDebug }) {
    const [input, setInput] = useState("");
    const [isDebugMode, setIsDebugMode] = useState(false);
    const messagesEndRef = useRef(null);
    const textareaRef = useRef(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    function handleInputChange(e) {
        const val = e.target.value;
        setInput(val);
        setIsDebugMode(detectTraceback(val));
    }

    function handleSend() {
        if (!input.trim() || llmLoading) return;
        if (isDebugMode) {
            onDebug(input);
        } else {
            onSend(input);
        }
        setInput("");
        setIsDebugMode(false);
    }

    function handleKeyDown(e) {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSend();
        }
    }

    return (
        <div className="flex flex-col h-full bg-[#111118] overflow-hidden">
            {/* Header */}
            <div className="panel-header">
                <span className="panel-title">AI Tutor</span>
                <div className="flex items-center gap-2">
                    {llmLoading && (
                        <div className="flex items-center gap-1.5 text-xs text-[#a78bfa] px-2.5 py-0.5 rounded-full bg-[#7c3aed]/10 border border-[#7c3aed]/30">
                            <div className="spinner !w-3.5 !h-3.5 !border" />
                            Thinking…
                        </div>
                    )}
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center gap-3 p-10 text-center flex-1">
                        <div className="text-5xl">🤖</div>
                        <h3 className="text-base font-bold">AI Tutor ready</h3>
                        <p className="text-[0.85rem] text-[#5a5a70] max-w-[260px] leading-relaxed">
                            Ask a follow-up question, request a code change, or paste a runtime traceback to auto-debug.
                        </p>
                        <div className="flex flex-col gap-1.5 w-full mt-2">
                            {[
                                "Explain how the selection operator works",
                                "Change the crossover rate to 0.8",
                                "Add elitism to the algorithm",
                                "What does the toolbox cell do?",
                            ].map(s => (
                                <button
                                    key={s}
                                    className="bg-[#18181f] border border-white/5 rounded-lg px-3.5 py-2 text-[0.8rem] text-[#9898b0] text-left hover:bg-[#1e1e28] hover:border-[#7c3aed] hover:text-[#f0f0f8] transition-all duration-150 font-inherit"
                                    onClick={() => { setInput(s); textareaRef.current?.focus(); }}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {messages.map((msg, i) => (
                    <div key={i} className="fade-in">
                        <MessageBubble msg={msg} />
                    </div>
                ))}

                {llmLoading && (
                    <div className="flex gap-2.5 animate-[fadeIn_0.2s_ease] flex-row items-start fade-in">
                        <div className="w-[30px] h-[30px] rounded-full bg-gradient-to-br from-[#7c3aed] to-[#5b21b6] flex items-center justify-center text-[0.9rem] shrink-0 shadow-[0_0_10px_rgba(124,58,237,0.35)]">
                            ⚡
                        </div>
                        <div className="bg-[#18181f] border border-white/5 rounded-r-xl rounded-bl-xl rounded-tl-sm px-[18px] py-[14px] flex gap-1 items-center">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#5a5a70] animate-bounce" />
                            <span className="w-1.5 h-1.5 rounded-full bg-[#5a5a70] animate-bounce [animation-delay:0.2s]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-[#5a5a70] animate-bounce [animation-delay:0.4s]" />
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-white/5 p-3 bg-[#0a0a0f] shrink-0">
                {isDebugMode && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#ef4444]/10 border border-[#ef4444]/30 text-[#ef4444] text-[0.78rem] mb-2">
                        🐛 Traceback detected — will call <strong>Auto-Debug</strong>
                    </div>
                )}
                <div className={`bg-[#18181f] border border-white/5 rounded-2xl overflow-hidden transition-all duration-200 focus-within:border-[#7c3aed]/50 focus-within:ring-2 focus-within:ring-[#7c3aed]/35 ${isDebugMode ? "border-[#ef4444]/40 focus-within:border-[#ef4444]/50 focus-within:ring-[#ef4444]/25" : ""}`}>
                    <textarea
                        ref={textareaRef}
                        id="chat-input"
                        className="w-full bg-transparent border-none outline-none resize-none px-3.5 py-2.5 text-[0.85rem] font-sans text-[#f0f0f8] placeholder-[#5a5a70] leading-relaxed"
                        placeholder={isDebugMode ? "Paste traceback…" : "Ask a question or request a change…"}
                        value={input}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        rows={3}
                        disabled={llmLoading}
                    />
                    <div className="flex items-center justify-between px-3 py-2 border-t border-white/5">
                        <span className="text-[0.72rem] text-[#5a5a70]">⌘+Enter to send</span>
                        <button
                            id="btn-send-chat"
                            className={`btn btn-sm ${isDebugMode ? "btn-danger" : "btn-primary"}`}
                            onClick={handleSend}
                            disabled={!input.trim() || llmLoading}
                        >
                            {isDebugMode ? "🐛 Auto-Debug" : "Send →"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

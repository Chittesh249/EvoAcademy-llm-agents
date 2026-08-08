"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export function usePyodide() {
    const [pyodideReady, setPyodideReady] = useState(false);
    const [statusText, setStatusText] = useState("Idle");
    const [loadingStatus, setLoadingStatus] = useState("uninitialized"); // "uninitialized" | "loading_script" | "initializing" | "loading_packages" | "ready" | "error"
    const [errorMsg, setErrorMsg] = useState(null);
    const pyodideRef = useRef(null);

    useEffect(() => {
        let active = true;

        async function initPyodide() {
            if (typeof window === "undefined") return;
            if (window.loadPyodide && pyodideRef.current) {
                setPyodideReady(true);
                setLoadingStatus("ready");
                return;
            }

            setLoadingStatus("loading_script");
            setStatusText("Loading Python runtime script...");

            // Inject Pyodide script tags if not already present
            if (!document.getElementById("pyodide-cdn-script")) {
                const script = document.createElement("script");
                script.id = "pyodide-cdn-script";
                script.src = "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js";
                script.async = true;
                document.body.appendChild(script);

                await new Promise((resolve, reject) => {
                    script.onload = resolve;
                    script.onerror = () => reject(new Error("Failed to load Pyodide from CDN"));
                });
            }

            if (!active) return;

            setLoadingStatus("initializing");
            setStatusText("Initializing WebAssembly engine...");

            try {
                const pyodide = await window.loadPyodide({
                    indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/",
                });

                if (!active) return;
                pyodideRef.current = pyodide;

                setLoadingStatus("loading_packages");
                setStatusText("Loading base scientific packages (numpy, matplotlib)...");
                await pyodide.loadPackage(["numpy", "matplotlib"]);

                if (!active) return;

                setStatusText("Loading Python package installer (micropip)...");
                await pyodide.loadPackage("micropip");

                if (!active) return;

                setStatusText("Setting up execution environment...");
                // Setup the runner script to execute code cells in a shared namespace and capture plots/outputs
                await pyodide.runPythonAsync(`
                    import sys, io, traceback

                    globals_dict = {}

                    def run_cell_code(code_string):
                        old_stdout = sys.stdout
                        old_stderr = sys.stderr
                        redirected_out = io.StringIO()
                        redirected_err = io.StringIO()
                        sys.stdout = redirected_out
                        sys.stderr = redirected_err
                        
                        exception = None
                        try:
                            # Pre-set basic DEAP and matplotlib modules in namespace if needed
                            if "__builtins__" not in globals_dict:
                                globals_dict["__builtins__"] = __builtins__
                            
                            # Execute the code in the shared global namespace
                            exec(code_string, globals_dict)
                        except Exception as e:
                            traceback.print_exc(file=redirected_err)
                            exception = str(e)
                        finally:
                            sys.stdout = old_stdout
                            sys.stderr = old_stderr
                            
                        plot_base64 = None
                        try:
                            import matplotlib
                            matplotlib.use('Agg')
                            from matplotlib import pyplot as plt
                            if plt.get_fignums():
                                import base64
                                buf = io.BytesIO()
                                plt.savefig(buf, format='png', bbox_inches='tight', dpi=100)
                                buf.seek(0)
                                plot_base64 = base64.b64encode(buf.read()).decode('utf-8')
                                plt.close('all')
                        except Exception as pe:
                            pass
                            
                        return {
                            "stdout": redirected_out.getvalue(),
                            "stderr": redirected_err.getvalue(),
                            "plot": plot_base64,
                            "has_error": exception is not None
                        }
                `);

                if (!active) return;
                setPyodideReady(true);
                setLoadingStatus("ready");
                setStatusText("Python environment ready");
            } catch (err) {
                console.error("Pyodide startup failed", err);
                if (active) {
                    setLoadingStatus("error");
                    setErrorMsg(err.message);
                    setStatusText("Initialization failed");
                }
            }
        }

        initPyodide();

        return () => {
            active = false;
        };
    }, []);

    const runPython = useCallback(async (code) => {
        if (!pyodideRef.current || !pyodideReady) {
            throw new Error("Python runtime is not loaded yet");
        }

        try {
            // Put code into a python variable to avoid escaping issues
            pyodideRef.current.globals.set("temp_cell_code", code);
            const pyResultProxy = await pyodideRef.current.runPythonAsync(`
                run_cell_code(temp_cell_code)
            `);
            
            // Convert python dict result to JS object
            const result = pyResultProxy.toJs({ dict_converter: Object.fromEntries });
            pyResultProxy.destroy();
            return result;
        } catch (err) {
            return {
                stdout: "",
                stderr: err.message,
                plot: null,
                has_error: true,
            };
        }
    }, [pyodideReady]);

    return {
        pyodideReady,
        loadingStatus,
        statusText,
        errorMsg,
        runPython,
    };
}

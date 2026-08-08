import os
import sys
import time
import json
import base64
import asyncio
import logging
import traceback
from typing import Dict, Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/python")

class ExecuteRequest(BaseModel):
    code: str
    session_id: Optional[str] = None

class ExecuteResponse(BaseModel):
    stdout: str
    stderr: str
    result: Optional[str] = None
    plot: Optional[str] = None
    has_error: bool
    execution_time: float
    execution_mode: str = "backend"

# Runner code executed inside the sandboxed python subprocess
RUNNER_CODE = """
import sys
import io
import json
import base64
import traceback

globals_dict = {}

def run_cell_code(code_string):
    old_stdout = sys.stdout
    old_stderr = sys.stderr
    sys.stdout = io.StringIO()
    sys.stderr = io.StringIO()
    
    exception = None
    try:
        if "__builtins__" not in globals_dict:
            globals_dict["__builtins__"] = __builtins__
        # Run code within persistent globals namespace
        exec(code_string, globals_dict)
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        exception = str(e)
    finally:
        stdout_val = sys.stdout.getvalue()
        stderr_val = sys.stderr.getvalue()
        sys.stdout = old_stdout
        sys.stderr = old_stderr
        
    plot_base64 = None
    try:
        import matplotlib
        matplotlib.use('Agg')
        from matplotlib import pyplot as plt
        if plt.get_fignums():
            buf = io.BytesIO()
            plt.savefig(buf, format='png', bbox_inches='tight')
            buf.seek(0)
            plot_base64 = base64.b64encode(buf.read()).decode('utf-8')
            plt.close('all')
    except Exception:
        pass
        
    return {
        "stdout": stdout_val,
        "stderr": stderr_val,
        "plot": plot_base64,
        "has_error": exception is not None
    }

def main():
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            code_str = base64.b64decode(line.strip()).decode('utf-8')
            res = run_cell_code(code_str)
            print(json.dumps(res))
            sys.stdout.flush()
        except KeyboardInterrupt:
            break
        except Exception as e:
            err_res = {
                "stdout": "",
                "stderr": f"Runner manager error: {traceback.format_exc()}",
                "plot": None,
                "has_error": True
            }
            print(json.dumps(err_res))
            sys.stdout.flush()

if __name__ == '__main__':
    main()
"""

class ProcessInfo:
    def __init__(self, process: asyncio.subprocess.Process, last_active: float):
        self.process = process
        self.last_active = last_active

# Global repository of active persistent processes per session_id
session_processes: Dict[str, ProcessInfo] = {}

async def get_or_create_process(session_id: str) -> asyncio.subprocess.Process:
    now = time.time()
    
    # 1. Clean up idle processes older than 5 minutes
    for sid, info in list(session_processes.items()):
        if now - info.last_active > 300:
            logger.info(f"[Python] Terminating idle session process: {sid}")
            try:
                info.process.kill()
            except Exception:
                pass
            session_processes.pop(sid, None)
            
    # 2. Check if process exists and is alive
    if session_id in session_processes:
        info = session_processes[session_id]
        if info.process.returncode is None:
            info.last_active = now
            return info.process
        else:
            # Process died, pop it
            session_processes.pop(session_id, None)
            
    logger.info(f"[Python] Spawning new isolated process for session: {session_id}")
    
    # 3. Restrict environment to prevent database or env credential leakages
    restricted_env = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONUNBUFFERED": "1"
    }
    
    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        RUNNER_CODE,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=restricted_env
    )
    
    session_processes[session_id] = ProcessInfo(proc, now)
    return proc

async def execute_code_in_process(proc: asyncio.subprocess.Process, code: str) -> dict:
    code_b64 = base64.b64encode(code.encode('utf-8')).decode('utf-8')
    input_line = f"{code_b64}\n"
    
    # Write encoded command line
    proc.stdin.write(input_line.encode('utf-8'))
    await proc.stdin.drain()
    
    # Read response line with a 10 second timeout limit
    try:
        result_line = await asyncio.wait_for(proc.stdout.readline(), timeout=10.0)
        if not result_line:
            raise Exception("Isolated runner process closed stdin/stdout streams unexpectedly.")
        return json.loads(result_line.decode('utf-8'))
    except asyncio.TimeoutError:
        logger.warning("[Python] Execution timeout exceeded. Killing subprocess.")
        try:
            proc.kill()
        except Exception:
            pass
        raise TimeoutError("Execution timed out after 10.0 seconds.")

@router.post("/execute", response_model=ExecuteResponse)
async def execute_python(req: ExecuteRequest):
    session_id = req.session_id
    code = req.code
    
    start_time = time.time()
    logger.info(f"[Python] Backend execution started (session_id={session_id})")
    
    stdout = ""
    stderr = ""
    plot = None
    has_error = False
    
    try:
        if session_id:
            # Persistent session scope
            proc = await get_or_create_process(session_id)
            res = await execute_code_in_process(proc, code)
        else:
            # One-off execution
            restricted_env = {
                "PATH": os.environ.get("PATH", ""),
                "PYTHONUNBUFFERED": "1"
            }
            proc = await asyncio.create_subprocess_exec(
                sys.executable,
                "-c",
                RUNNER_CODE,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=restricted_env
            )
            try:
                res = await execute_code_in_process(proc, code)
            finally:
                try:
                    proc.kill()
                except Exception:
                    pass
                    
        stdout = res.get("stdout", "")
        stderr = res.get("stderr", "")
        plot = res.get("plot", None)
        has_error = res.get("has_error", False)
        
    except TimeoutError as te:
        has_error = True
        stderr = f"TimeoutError: {str(te)}"
        if session_id:
            # Evict from active cache since it was killed
            session_processes.pop(session_id, None)
    except Exception as e:
        has_error = True
        stderr = f"ExecutionException: {str(e)}\n{traceback.format_exc()}"
        if session_id:
            session_processes.pop(session_id, None)
            
    execution_time = time.time() - start_time
    logger.info(f"[Python] Backend execution completed in {execution_time:.3f}s")
    
    return ExecuteResponse(
        stdout=stdout,
        stderr=stderr,
        plot=plot,
        has_error=has_error,
        execution_time=execution_time,
        execution_mode="backend"
    )

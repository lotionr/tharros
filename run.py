#!/usr/bin/env python3
"""
Tharros harness — runs initializer or coding agent via Claude Code SDK.

Usage:
  python harness/run.py              # auto-detects which agent to use
  python harness/run.py --init       # force initializer (session 1)
  python harness/run.py --code       # force coding agent (session 2+)
  python harness/run.py --loop 5     # run coding agent N times in a row
"""

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.resolve()
PROMPTS_DIR = Path(__file__).parent / "prompts"
INITIALIZER_PROMPT = PROMPTS_DIR / "initializer.md"
CODING_AGENT_PROMPT = PROMPTS_DIR / "coding_agent.md"
PROGRESS_FILE = PROJECT_ROOT / "claude-progress.txt"
FEATURE_LIST = PROJECT_ROOT / "feature_list.json"


def is_initialized() -> bool:
    """Check if the initializer has already run."""
    return PROGRESS_FILE.exists() and FEATURE_LIST.exists()


def read_prompt(path: Path) -> str:
    with open(path, "r") as f:
        return f.read()


def run_claude_code(prompt: str, session_label: str) -> int:
    """
    Run claude via the Claude Code CLI with the given prompt.
    Uses --print mode for non-interactive execution.
    """
    print(f"\n{'='*60}")
    print(f"  {session_label}")
    print(f"{'='*60}\n")

    cmd = [
        "claude",
        "--print",                    # non-interactive, print output and exit
        "--dangerously-skip-permissions",  # needed for harness automation
        "-p", prompt,
    ]

    result = subprocess.run(
        cmd,
        cwd=str(PROJECT_ROOT),
        env={**os.environ},
    )

    return result.returncode


def run_initializer():
    print("No progress file found — running INITIALIZER AGENT (session 1)")
    prompt = read_prompt(INITIALIZER_PROMPT)
    rc = run_claude_code(prompt, "INITIALIZER AGENT — Setting up environment")
    if rc != 0:
        print(f"\n[ERROR] Initializer exited with code {rc}")
        sys.exit(rc)
    print("\n[OK] Initializer complete. Run again to start coding sessions.")


def run_coding_agent(session_num: int = 2):
    prompt = read_prompt(CODING_AGENT_PROMPT)
    label = f"CODING AGENT — Session {session_num}"
    rc = run_claude_code(prompt, label)
    if rc != 0:
        print(f"\n[WARN] Coding agent session {session_num} exited with code {rc}")
    return rc


def count_sessions() -> int:
    """Count how many sessions have been logged in claude-progress.txt."""
    if not PROGRESS_FILE.exists():
        return 0
    content = PROGRESS_FILE.read_text()
    return content.count("--- SESSION")


def main():
    parser = argparse.ArgumentParser(description="Tharros agent harness")
    parser.add_argument("--init", action="store_true", help="Force initializer agent")
    parser.add_argument("--code", action="store_true", help="Force coding agent")
    parser.add_argument("--loop", type=int, default=1,
                        help="Run coding agent N times (default: 1)")
    args = parser.parse_args()

    if args.init or not is_initialized():
        run_initializer()
        return

    session_num = count_sessions() + 1
    for i in range(args.loop):
        current_session = session_num + i
        rc = run_coding_agent(session_num=current_session)
        if i < args.loop - 1:
            print(f"\n[harness] Waiting 3s before next session...")
            time.sleep(3)


if __name__ == "__main__":
    main()

# resume-autonomous-build.ps1
# Run this after Claude Code usage limits reset to resume autonomous v0.1.0 build.
# Usage: .\scripts\resume-autonomous-build.ps1
# Or schedule in Windows Task Scheduler to retry every 10 minutes.

param(
  [switch]$Scheduled  # Pass -Scheduled when running from Task Scheduler
)

$ProjectDir = "C:\Users\NF\Documents\Projects\iranti-control-plane"
$LogFile = "$ProjectDir\scripts\resume-log.txt"
$PromptFile = "$ProjectDir\scripts\resume-prompt.txt"

function Log($msg) {
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "$ts  $msg" | Tee-Object -Append -FilePath $LogFile
}

# Test if Claude Code is reachable (no rate limit) by running a trivial command
function Test-ClaudeAvailable {
  try {
    $result = & claude --print "reply with just OK" 2>&1
    return $result -match "OK"
  } catch {
    return $false
  }
}

Log "=== Iranti Control Plane — Autonomous Build Resume ==="

if ($Scheduled) {
  Log "Running in scheduled mode — testing Claude availability..."
  if (-not (Test-ClaudeAvailable)) {
    Log "Claude not available yet (rate limit still active). Will retry later."
    exit 0
  }
  Log "Claude available — proceeding."
}

# Write resume prompt
@"
You are resuming autonomous work on the Iranti Control Plane v0.1.0.

Project: C:\Users\NF\Documents\Projects\iranti-control-plane
GitHub: https://github.com/nfemmanuel/iranti-control-plane

Resume instructions:
1. Call iranti_handshake to reload project state.
2. Check CI status: gh run list --limit 5 --repo nfemmanuel/iranti-control-plane
3. Fix any CI failures first.
4. Query Iranti for active tickets and agent assignments.
5. Continue building toward stable v0.1.0.
6. PM agent should review completed tickets and assign new work.
7. All 8 specialist agents should be utilized.
8. Do not ask the user for input — operate autonomously until v0.1.0 is testable.
"@ | Set-Content $PromptFile

Log "Launching Claude Code to resume autonomous build..."
Set-Location $ProjectDir

# Launch Claude in a new window so this script exits cleanly
Start-Process -FilePath "claude" -ArgumentList "--print", (Get-Content $PromptFile -Raw) -NoNewWindow

Log "Claude Code launched. Monitor progress in the Claude Code session."

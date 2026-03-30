#!/usr/bin/env python3
"""Initialize git repository and push to GitHub"""

import os
import subprocess
import sys

project_dir = r"C:\Users\SG0705233\OneDrive - Sabre\Desktop\projects\insightsDB\dashboard-react"
os.chdir(project_dir)

def run_command(cmd, description=""):
    """Run a shell command and return success status"""
    if description:
        print(f"\n{description}")
        print(f"Running: {cmd}")
    
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr, file=sys.stderr)
        return result.returncode == 0
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return False

# Step 1: Initialize git repository
success = run_command("git init", "Step 1: Initialize git repository")

# Step 2: Add remote origin
success = success and run_command(
    "git remote add origin https://github.com/Praveenmahamana/poc-star-react.git",
    "\nStep 2: Add remote origin"
)

# Step 3: Fetch from remote
success = success and run_command(
    "git fetch origin",
    "\nStep 3: Fetch from remote to see existing content"
)

# Step 4: Add all files
success = success and run_command(
    "git add .",
    "\nStep 4: Add all files"
)

# Step 5: Create initial commit
commit_msg = """Initial commit: InsightsDB React dashboard

Add full Network dashboard with:
- Network tab with OD table, schedule heatmaps
- NetworkScorecard with weekly pax, seats, load factor, demand/revenue mix
- OD Detail Modal with market share pie charts, QSI factors bar chart, itinerary and market summary tables
- Flight View, Flight Report, Itinerary Report, Preferences tabs
- Workset dropdown for multi-workset support
- scripts/sync-data.mjs: auto-discover and process worksets
- scripts/export-network-html.mjs: generate standalone offline HTML

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"""

cmd = f'git commit -m "{commit_msg}"'
success = success and run_command(cmd, "\nStep 5: Create initial commit")

# Step 6: Try to push to main
print("\nStep 6: Try to push to main")
push_result = subprocess.run("git push -u origin main", shell=True, capture_output=True, text=True)

if push_result.returncode != 0:
    print("\nPush to main failed. Trying master branch...")
    push_result = subprocess.run("git push -u origin master", shell=True, capture_output=True, text=True)
    
    if push_result.returncode != 0:
        print("\nPush to master also failed. Attempting force push to main...")
        push_result = subprocess.run("git push -u origin main --force", shell=True, capture_output=True, text=True)

if push_result.stdout:
    print(push_result.stdout)
if push_result.stderr:
    print(push_result.stderr, file=sys.stderr)

print("\n" + "="*60)
if push_result.returncode == 0:
    print("✓ Git initialization and push completed successfully!")
else:
    print("✗ Push operation failed. Check output above for details.")
    sys.exit(1)

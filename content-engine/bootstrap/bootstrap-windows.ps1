<#
.SYNOPSIS
    Sets up the content engine on the D: drive.

.DESCRIPTION
    Creates the folder layout, clones the repository, installs dependencies and
    prepares the .env file. Safe to re-run: existing folders and files are left alone,
    and an existing clone is updated rather than replaced.

.PARAMETER Root
    Where everything lives. Defaults to D:\ContentEngine.

.PARAMETER RepoUrl
    The repository to clone.

.PARAMETER RegisterTask
    Also register a Windows scheduled task that runs the produce cycle hourly.
    Only useful if you want local rendering; the GitHub Actions schedule runs
    regardless of whether this machine is on.

.EXAMPLE
    .\bootstrap-windows.ps1
    .\bootstrap-windows.ps1 -Root E:\ContentEngine -RegisterTask
#>

[CmdletBinding()]
param(
    [string] $Root = 'D:\ContentEngine',
    [string] $RepoUrl = 'https://github.com/buddybuses-dev/content-engine.git',
    [switch] $RegisterTask
)

$ErrorActionPreference = 'Stop'

function Write-Step { param([string] $Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok   { param([string] $Message) Write-Host "    $Message" -ForegroundColor Green }
function Write-Note { param([string] $Message) Write-Host "    $Message" -ForegroundColor Yellow }

# --- preflight -------------------------------------------------------------

Write-Step 'Checking prerequisites'

$drive = Split-Path -Qualifier $Root
if (-not (Test-Path $drive)) {
    throw "Drive $drive is not available. Pass -Root with a drive that exists."
}

foreach ($tool in @('git', 'node', 'npm')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool is not on PATH. Install it first: git-scm.com / nodejs.org (Node 20+)."
    }
}

$nodeMajor = [int]((node --version) -replace '^v(\d+).*', '$1')
if ($nodeMajor -lt 20) { throw "Node 20 or newer is required; found $(node --version)." }
Write-Ok "git, node $(node --version), npm present"

# --- layout ----------------------------------------------------------------
# Media is kept OUTSIDE the repo clone so large exports never risk being committed,
# and so a fresh clone never wipes work in progress.

Write-Step "Creating layout under $Root"

$repoPath  = Join-Path $Root 'repo'
$mediaPath = Join-Path $Root 'media'

$folders = @(
    $Root,
    $mediaPath,
    (Join-Path $mediaPath 'inbox'),
    (Join-Path $mediaPath 'broll'),
    (Join-Path $mediaPath 'music'),
    (Join-Path $mediaPath 'out'),
    (Join-Path $Root 'archive'),
    (Join-Path $Root 'logs')
)
foreach ($folder in $folders) {
    if (Test-Path $folder) { continue }
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
    Write-Ok "created $folder"
}

# --- repository ------------------------------------------------------------

Write-Step 'Fetching the repository'

if (Test-Path (Join-Path $repoPath '.git')) {
    Push-Location $repoPath
    git pull --ff-only
    Pop-Location
    Write-Ok 'existing clone updated'
} else {
    git clone $RepoUrl $repoPath
    Write-Ok "cloned into $repoPath"
}

# --- link media into the repo ---------------------------------------------
# The pipeline reads media/ relative to the repo, so point it at the folders above
# with directory junctions. Junctions need no admin rights, unlike symlinks.

Write-Step 'Linking media folders into the clone'

$repoMedia = Join-Path $repoPath 'media'
foreach ($name in @('inbox', 'broll', 'music', 'out')) {
    $linkPath   = Join-Path $repoMedia $name
    $targetPath = Join-Path $mediaPath $name

    $existing = Get-Item $linkPath -ErrorAction SilentlyContinue
    if ($existing -and $existing.LinkType) { Write-Ok "$name already linked"; continue }

    if ($existing) {
        # A real folder from the clone. Move anything in it across, then replace it.
        Get-ChildItem $linkPath -File | Where-Object { $_.Name -ne '.gitkeep' } |
            Move-Item -Destination $targetPath -Force
        Remove-Item $linkPath -Recurse -Force
    }
    New-Item -ItemType Junction -Path $linkPath -Target $targetPath | Out-Null
    Write-Ok "$name -> $targetPath"
}

# --- dependencies ----------------------------------------------------------

Write-Step 'Installing dependencies'
Push-Location $repoPath
npm install --no-audit --no-fund
Pop-Location
Write-Ok 'dependencies installed'

# --- environment -----------------------------------------------------------

Write-Step 'Preparing .env'

$envPath = Join-Path $repoPath '.env'
if (Test-Path $envPath) {
    Write-Ok '.env already exists, leaving it untouched'
} else {
    Copy-Item (Join-Path $repoPath '.env.example') $envPath
    Write-Ok "created $envPath"
    Write-Note 'Fill in ANTHROPIC_API_KEY at minimum, then see docs\SETUP.md.'
}

# --- optional scheduled task ----------------------------------------------

if ($RegisterTask) {
    Write-Step 'Registering the hourly scheduled task'

    $taskName = 'ContentEngine-Produce'
    $action = New-ScheduledTaskAction -Execute 'npm.cmd' -Argument 'run cycle' -WorkingDirectory $repoPath
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Hours 1)
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Description 'Content engine produce cycle' -Force | Out-Null
    Write-Ok "registered scheduled task '$taskName'"
    Write-Note 'This only runs while the machine is on. GitHub Actions runs regardless.'
}

# --- done ------------------------------------------------------------------

Write-Host ''
Write-Step 'Done'
Write-Host @"

  Repo      $repoPath
  Media     $mediaPath
  Env       $envPath

  Next:
    1. Fill in $envPath              (see docs\SETUP.md)
    2. Edit config\channel.config.json   - the channel name is still "CHANGE ME"
    3. Add a product to config\whop.sources.json with enabled: true
    4. cd $repoPath ; npm run health

  Drop video exports into $mediaPath\inbox named after the queue item id.

"@ -ForegroundColor Gray

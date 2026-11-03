<#
.SYNOPSIS
  Bumps Muriel's version in package.json, package-lock.json and VERSION.

.DESCRIPTION
  The version is MAJOR.MINOR.PATCH:
    major  -> 1.3.11 becomes 2.0.0
    minor  -> 1.3.11 becomes 1.4.0
    patch  -> 1.3.11 becomes 1.3.12
  "fix" is accepted as another name for "patch".

  This only edits the version files. It does not commit, tag or push.
  Android and iOS read the version from package.json, so nothing else needs
  changing.

.PARAMETER Part
  major, minor, patch, or fix.

.PARAMETER Changelog
  Also prepend a dated entry to CHANGELOG.md with a section to fill in.

.PARAMETER DryRun
  Show the next version without changing any files.

.EXAMPLE
  .\tools\bump-version.ps1 -Part patch

.EXAMPLE
  .\tools\bump-version.ps1 -Part minor -Changelog

.EXAMPLE
  .\tools\bump-version.ps1 -Part major -DryRun
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('major', 'minor', 'patch', 'fix')]
    [string]$Part,

    [switch]$Changelog,

    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

function Invoke-Checked([string]$Exe, [string[]]$Arguments) {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Exe failed (exit code $LASTEXITCODE)."
    }
}

function Write-Utf8([string]$Path, [string]$Text) {
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Add-ChangelogEntry([string]$Version, [string]$Kind) {
    $path = Join-Path $root 'CHANGELOG.md'
    if (-not (Test-Path $path)) {
        Write-Warning 'CHANGELOG.md was not found; skipping the changelog entry.'
        return $false
    }

    $text = [System.IO.File]::ReadAllText($path)
    $nl = if ($text -match "`r`n") { "`r`n" } else { "`n" }
    $section = if ($Kind -eq 'major') { 'Changed' } elseif ($Kind -eq 'minor') { 'Added' } else { 'Fixed' }
    $dash = [char]0x2014
    $date = Get-Date -Format 'yyyy-MM-dd'
    $entry = "## $Version $dash $date$nl$nl### $section$nl$nl- $nl$nl"

    $firstEntry = [regex]::Match($text, '(?m)^## ')
    if ($firstEntry.Success) {
        $text = $text.Substring(0, $firstEntry.Index) + $entry + $text.Substring($firstEntry.Index)
    } else {
        $text = $text.TrimEnd() + $nl + $nl + $entry
    }
    Write-Utf8 $path $text
    return $true
}

try {
    $packagePath = Join-Path $root 'package.json'
    if (-not (Test-Path $packagePath)) {
        throw "package.json was not found in $root."
    }

    $current = [string]((Get-Content $packagePath -Raw | ConvertFrom-Json).version)
    if ($current -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
        throw "package.json version '$current' is not in MAJOR.MINOR.PATCH form."
    }

    $kind = if ($Part -eq 'fix') { 'patch' } else { $Part }
    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    $patch = [int]$Matches[3]

    switch ($kind) {
        'major' { $major++; $minor = 0; $patch = 0 }
        'minor' { $minor++; $patch = 0 }
        'patch' { $patch++ }
    }
    $next = "$major.$minor.$patch"

    $versionPath = Join-Path $root 'VERSION'
    if (Test-Path $versionPath) {
        $onDisk = [System.IO.File]::ReadAllText($versionPath).Trim()
        if ($onDisk -and $onDisk -ne $current) {
            Write-Warning "VERSION ($onDisk) did not match package.json ($current); both will be set to $next."
        }
    }

    Write-Host ''
    Write-Host "Muriel $current -> $next ($kind)" -ForegroundColor Cyan

    if ($DryRun) {
        Write-Host 'Dry run: no files were changed.' -ForegroundColor Yellow
        return
    }

    Invoke-Checked 'npm' @('version', $next, '--no-git-tag-version', '--allow-same-version')

    # Keep VERSION in step with package.json, preserving its line-ending style.
    $oldVersionText = if (Test-Path $versionPath) { [System.IO.File]::ReadAllText($versionPath) } else { '' }
    $versionNl = if ($oldVersionText -match "`r`n") { "`r`n" } else { "`n" }
    Write-Utf8 $versionPath ($next + $versionNl)

    $changelogUpdated = $false
    if ($Changelog) {
        $changelogUpdated = Add-ChangelogEntry $next $kind
    }

    Write-Host ''
    Write-Host 'Updated:' -ForegroundColor Green
    Write-Host '  package.json'
    Write-Host '  package-lock.json'
    Write-Host '  VERSION'
    if ($changelogUpdated) { Write-Host '  CHANGELOG.md' }
    Write-Host ''
    Write-Host 'No commit, tag or push was made.' -ForegroundColor Yellow
} finally {
    Pop-Location
}

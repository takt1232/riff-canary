<#
.SYNOPSIS
  Builds Canary for the Windows desktop and/or Android.

.DESCRIPTION
  Desktop  : runs electron-builder and leaves the installer in dist\.
  Android  : rebuilds the mobile web bundle in www\, syncs it into the Android
             project, then builds a debug APK. -Install copies the APK to the
             connected phone with adb.

  Android needs JDK 21. android/settings.gradle asks Gradle to download one
  into %USERPROFILE%\.gradle\jdks when the machine only has an older JDK, so
  JAVA_HOME does not have to change.

.PARAMETER Target
  all (default), desktop, or android.

.PARAMETER Install
  Android only: install the APK on the connected device after building.

.PARAMETER Device
  Android only: adb serial to use when more than one device is connected.

.PARAMETER VersionCode
  Android only: versionCode for the APK. Defaults to a timestamp, which rises
  with every build so the new APK installs over the previous one.

.EXAMPLE
  .\tools\build.ps1
  Builds both the desktop installer and the Android APK.

.EXAMPLE
  .\tools\build.ps1 -Target android -Install
  Builds the APK and installs it on the connected phone.

.EXAMPLE
  .\tools\build.ps1 -Target desktop
  Builds only the Windows desktop installer.
#>
[CmdletBinding()]
param(
    [ValidateSet('all', 'desktop', 'android')]
    [string]$Target = 'all',

    [switch]$Install,

    [string]$Device = '',

    [int]$VersionCode = 0
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

function Write-Step([string]$Text) {
    Write-Host ''
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
}

function Invoke-Checked([string]$Exe, [string[]]$Arguments) {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Exe failed (exit code $LASTEXITCODE)."
    }
}

function Get-AppVersion {
    $package = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
    return $package.version
}

function Find-Adb {
    $cmd = Get-Command 'adb' -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    foreach ($sdk in @($env:ANDROID_SDK_ROOT, $env:ANDROID_HOME)) {
        if (-not $sdk) { continue }
        $candidate = Join-Path $sdk 'platform-tools\adb.exe'
        if (Test-Path $candidate) { return $candidate }
    }
    return $null
}

function Build-Desktop {
    Write-Step 'Desktop: checking dependencies'
    Require-Command 'npm'
    if (-not (Test-Path (Join-Path $root 'node_modules'))) {
        throw "node_modules is missing. Run 'npm install' in $root first."
    }

    # The electron npm package can be present without its downloaded runtime (for example after a failed
    # postinstall), and electron-builder then fails with a much less useful message.
    $electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
    if (-not (Test-Path $electron)) {
        Write-Host 'Electron binary is missing; downloading it now...'
        Invoke-Checked 'node' @((Join-Path $root 'node_modules\electron\install.js'))
    }

    Write-Step 'Desktop: building the installer (electron-builder)'
    Invoke-Checked 'npm' @('run', 'dist')

    $exe = Get-ChildItem (Join-Path $root 'dist') -Filter '*.exe' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($exe) {
        Write-Host "Desktop build: $($exe.FullName)" -ForegroundColor Green
    } else {
        Write-Host 'Desktop build finished; see the dist folder for the output.' -ForegroundColor Yellow
    }
}

function Install-Apk([string]$Apk) {
    $adb = Find-Adb
    if (-not $adb) {
        throw 'adb was not found. Install Android platform-tools or add it to PATH.'
    }

    $serial = $Device
    if (-not $serial) {
        $devices = @()
        foreach ($line in (& $adb devices)) {
            if ($line -match '^(\S+)\s+device$') { $devices += $Matches[1] }
        }
        if ($devices.Count -eq 0) {
            throw 'No Android device is connected. Connect the phone (USB or wireless ADB) and try again.'
        }
        $serial = $devices[0]
        if ($devices.Count -gt 1) {
            Write-Host "More than one device is connected; using $serial. Pass -Device <serial> to pick another." -ForegroundColor Yellow
        }
    }

    Write-Step "Android: installing on $serial"
    Invoke-Checked $adb @('-s', $serial, 'install', '-r', $Apk)
}

function Build-Android {
    Write-Step 'Android: checking dependencies'
    Require-Command 'node'
    Require-Command 'npx'
    if (-not (Test-Path (Join-Path $root 'android\gradlew.bat'))) {
        throw "The Android project is missing ($root\android)."
    }
    if (-not (Test-Path (Join-Path $root 'node_modules'))) {
        throw "node_modules is missing. Run 'npm install' in $root first."
    }

    $appVersion = Get-AppVersion
    if ($VersionCode -le 0) {
        # Android only installs an APK whose versionCode is higher than the one already on the phone.
        # Unix seconds are monotonic and still fit in Android's 32-bit versionCode.
        $VersionCode = [int]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() % 2000000000)
    }

    Write-Step 'Android: rebuilding the mobile web bundle'
    Invoke-Checked 'node' @('mobile/build.mjs')

    Write-Step 'Android: syncing www into the Android project'
    Invoke-Checked 'npx' @('cap', 'sync', 'android')

    Write-Step "Android: building the debug APK (version $appVersion, code $VersionCode)"
    $env:CANARY_VERSION_NAME = $appVersion
    $env:CANARY_VERSION_CODE = [string]$VersionCode
    Push-Location (Join-Path $root 'android')
    try {
        Invoke-Checked '.\gradlew.bat' @('assembleDebug')
    } finally {
        Pop-Location
        Remove-Item Env:\CANARY_VERSION_NAME -ErrorAction SilentlyContinue
        Remove-Item Env:\CANARY_VERSION_CODE -ErrorAction SilentlyContinue
    }

    $apk = Join-Path $root 'android\app\build\outputs\apk\debug\app-debug.apk'
    if (-not (Test-Path $apk)) {
        throw "The APK was not created at $apk"
    }
    Write-Host "Android build: $apk" -ForegroundColor Green

    if ($Install) { Install-Apk $apk }
}

try {
    if ($Install -and $Target -eq 'desktop') {
        throw '-Install is for Android builds; use -Target android (or omit -Target).'
    }

    if ($Target -eq 'desktop' -or $Target -eq 'all') { Build-Desktop }
    if ($Target -eq 'android' -or $Target -eq 'all') { Build-Android }

    Write-Host ''
    Write-Host 'Build complete.' -ForegroundColor Green
} finally {
    Pop-Location
}

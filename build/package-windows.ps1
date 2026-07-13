[CmdletBinding()]
param(
    [ValidateSet("x64", "arm64", "all")]
    [string]$Arch,

    [ValidateSet("nsis", "msi", "all")]
    [string]$Bundle = "all",

    [switch]$SkipInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-CommandAvailable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$InstallHint
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "缺少命令 $Name。$InstallHint"
    }
}

function Get-VsWherePath {
    $installerPath = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path -LiteralPath $installerPath -PathType Leaf) {
        return $installerPath
    }

    $command = Get-Command "vswhere.exe" -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    throw "缺少 vswhere.exe。请通过 Visual Studio Installer 安装 Visual Studio Build Tools。"
}

function Get-VisualStudioInstallationPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$VsWherePath,

        [Parameter(Mandatory = $true)]
        [string[]]$ComponentIds
    )

    $vsWhereArguments = @("-latest", "-products", "*", "-requires") +
        $ComponentIds +
        @("-property", "installationPath")
    $installationPaths = @(& $VsWherePath @vsWhereArguments)
    if ($LASTEXITCODE -ne 0) {
        throw "vswhere.exe 无法检查 Visual Studio 安装。"
    }

    $installationPath = $installationPaths |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Select-Object -First 1
    if (-not $installationPath) {
        throw "没有找到同时包含以下组件的 Visual Studio 安装：$($ComponentIds -join ', ')。请通过 Visual Studio Installer 补齐对应的 MSVC C++ build tools。"
    }

    return $installationPath
}

function Enter-VisualStudioTargetEnvironment {
    param(
        [Parameter(Mandatory = $true)]
        [string]$LaunchVsDevShellPath,

        [Parameter(Mandatory = $true)]
        [ValidateSet("x64", "arm64")]
        [string]$TargetArchitecture
    )

    $vsDevShellArchitecture = if ($TargetArchitecture -eq "x64") { "amd64" } else { "arm64" }
    Write-Host "初始化 Visual Studio 工具链：HostArch=amd64, Arch=$vsDevShellArchitecture" -ForegroundColor DarkGray
    & $LaunchVsDevShellPath `
        -Arch $vsDevShellArchitecture `
        -HostArch "amd64" `
        -SkipAutomaticLocation
    if (-not $?) {
        throw "无法为目标架构 $TargetArchitecture 初始化 Visual Studio Developer PowerShell。"
    }

    $reportedTargetArchitecture = switch ($env:VSCMD_ARG_TGT_ARCH) {
        "amd64" { "x64" }
        "x64" { "x64" }
        "arm64" { "arm64" }
        default { $env:VSCMD_ARG_TGT_ARCH }
    }
    if ($reportedTargetArchitecture -ne $TargetArchitecture) {
        throw "Visual Studio Developer PowerShell 目标架构不匹配：请求 $TargetArchitecture，实际 VSCMD_ARG_TGT_ARCH=$($env:VSCMD_ARG_TGT_ARCH)。"
    }

    Assert-CommandAvailable -Name "cl.exe" -InstallHint "请安装目标架构对应的 MSVC C++ build tools。"
    Assert-CommandAvailable -Name "link.exe" -InstallHint "请安装目标架构对应的 MSVC linker。"
    Assert-CommandAvailable -Name "rc.exe" -InstallHint "请安装 Windows SDK。"
}

function Assert-MsiPrerequisites {
    $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $currentPrincipal = [Security.Principal.WindowsPrincipal]::new($currentIdentity)
    if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "构建 MSI 需要检查 VBSCRIPT Windows capability。请以管理员身份启动 PowerShell 后重试，或使用 -Bundle nsis。"
    }

    $capabilityCommand = Get-Command "Get-WindowsCapability" -ErrorAction SilentlyContinue
    if (-not $capabilityCommand) {
        throw "无法检查 VBSCRIPT 可选功能：缺少 Get-WindowsCapability。请在受支持的 Windows PowerShell 中运行，或只构建 NSIS。"
    }

    try {
        $vbscriptCapability = Get-WindowsCapability -Online |
            Where-Object { $_.Name -like "VBSCRIPT*" } |
            Select-Object -First 1
    } catch {
        throw "无法检查 VBSCRIPT 可选功能。请以有权读取 Windows capability 的 PowerShell 运行，或只构建 NSIS。原始错误：$($_.Exception.Message)"
    }

    if ($vbscriptCapability -and $vbscriptCapability.State -ne "Installed") {
        throw "构建 MSI 必须启用 VBSCRIPT 可选功能。请在管理员 PowerShell 中执行：Add-WindowsCapability -Online -Name '$($vbscriptCapability.Name)'"
    }

    Assert-CommandAvailable `
        -Name "cscript.exe" `
        -InstallHint "构建 MSI 必须启用 VBSCRIPT 可选功能；请在 Windows 设置的可选功能中启用后重试，或只构建 NSIS。"
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [Parameter(Mandatory = $true)]
        [string[]]$ArgumentList
    )

    Write-Host "> $FilePath $($ArgumentList -join ' ')" -ForegroundColor DarkGray
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "命令执行失败（退出码 $LASTEXITCODE）：$FilePath $($ArgumentList -join ' ')"
    }
}

function Get-NativeWindowsArchitecture {
    $nativeArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    switch ($nativeArchitecture) {
        "X64" { return "x64" }
        "Arm64" { return "arm64" }
        default { throw "不支持的 Windows 宿主架构：$nativeArchitecture。仅支持 x64 和 arm64。" }
    }
}

if ($env:OS -ne "Windows_NT") {
    throw "Windows 安装包只能在 Windows 宿主机上构建。当前 OS=$($env:OS)。"
}

if (-not $PSBoundParameters.ContainsKey("Arch")) {
    $Arch = Get-NativeWindowsArchitecture
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$desktopDirectory = Join-Path $repoRoot "desktop"
$tauriDirectory = Join-Path $desktopDirectory "src-tauri"

if (-not (Test-Path -LiteralPath (Join-Path $desktopDirectory "package.json") -PathType Leaf)) {
    throw "未找到 desktop/package.json，请从完整仓库中运行本脚本。"
}
if (-not (Test-Path -LiteralPath (Join-Path $tauriDirectory "Cargo.toml") -PathType Leaf)) {
    throw "未找到 desktop/src-tauri/Cargo.toml，请从完整仓库中运行本脚本。"
}

Assert-CommandAvailable -Name "npm" -InstallHint "请安装项目要求的 Node.js 和 npm。"
Assert-CommandAvailable -Name "node" -InstallHint "请安装项目要求的 Node.js。"
Assert-CommandAvailable -Name "cargo" -InstallHint "请通过 rustup 安装 Rust 工具链。"
Assert-CommandAvailable -Name "rustup" -InstallHint "请安装 rustup，并由用户显式安装所需 target。"

$targetTriples = switch ($Arch) {
    "x64" { @("x86_64-pc-windows-msvc") }
    "arm64" { @("aarch64-pc-windows-msvc") }
    "all" { @("x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc") }
}

$bundleTargets = switch ($Bundle) {
    "nsis" { @("nsis") }
    "msi" { @("msi") }
    "all" { @("nsis", "msi") }
}

if ("msi" -in $bundleTargets) {
    Assert-MsiPrerequisites
}

$vsWherePath = Get-VsWherePath
$requiredVisualStudioComponents = @($targetTriples | ForEach-Object {
    switch ($_) {
        "x86_64-pc-windows-msvc" { "Microsoft.VisualStudio.Component.VC.Tools.x86.x64" }
        "aarch64-pc-windows-msvc" { "Microsoft.VisualStudio.Component.VC.Tools.ARM64" }
    }
} | Select-Object -Unique)
$visualStudioInstallationPath = Get-VisualStudioInstallationPath `
    -VsWherePath $vsWherePath `
    -ComponentIds $requiredVisualStudioComponents
$launchVsDevShellPath = Join-Path $visualStudioInstallationPath "Common7\Tools\Launch-VsDevShell.ps1"
if (-not (Test-Path -LiteralPath $launchVsDevShellPath -PathType Leaf)) {
    throw "Visual Studio 安装中缺少 Developer PowerShell 入口：$launchVsDevShellPath"
}

$installedTargets = @(& rustup target list --installed)
if ($LASTEXITCODE -ne 0) {
    throw "无法读取已安装的 Rust targets。"
}

$missingTargets = @($targetTriples | Where-Object { $_ -notin $installedTargets })
if ($missingTargets.Count -gt 0) {
    $installCommands = $missingTargets | ForEach-Object { "rustup target add $_" }
    throw "缺少 Rust target：$($missingTargets -join ', ')。本脚本不会自动安装，请先手动执行：`n$($installCommands -join "`n")"
}

Write-Host "Windows Tauri 打包" -ForegroundColor Cyan
Write-Host "  架构：$Arch ($($targetTriples -join ', '))"
Write-Host "  安装包：$($bundleTargets -join ', ')"
Write-Host "  签名：已禁用（--no-sign）"

Push-Location $repoRoot
try {
    if (-not $SkipInstall) {
        Invoke-CheckedCommand -FilePath "npm" -ArgumentList @("ci", "--prefix", "desktop")
    } else {
        Write-Host "已跳过 npm ci；将使用 desktop 现有依赖。" -ForegroundColor Yellow
    }

    $bundleArgument = $bundleTargets -join ","
    foreach ($targetTriple in $targetTriples) {
        $vsTargetArchitecture = if ($targetTriple -eq "x86_64-pc-windows-msvc") { "x64" } else { "arm64" }
        Enter-VisualStudioTargetEnvironment `
            -LaunchVsDevShellPath $launchVsDevShellPath `
            -TargetArchitecture $vsTargetArchitecture

        $bundleRoot = Join-Path $tauriDirectory "target/$targetTriple/release/bundle"
        foreach ($bundleTarget in $bundleTargets) {
            $staleBundleDirectory = Join-Path $bundleRoot $bundleTarget
            if (Test-Path -LiteralPath $staleBundleDirectory) {
                Remove-Item -LiteralPath $staleBundleDirectory -Recurse -Force
            }
        }

        Write-Host "开始构建 $targetTriple ..." -ForegroundColor Cyan
        Invoke-CheckedCommand -FilePath "npm" -ArgumentList @(
            "--prefix", "desktop",
            "run", "tauri", "--",
            "build",
            "--target", $targetTriple,
            "--bundles", $bundleArgument,
            "--ci",
            "--no-sign"
        )

        $targetArtifacts = @()
        foreach ($bundleTarget in $bundleTargets) {
            $bundleDirectory = Join-Path $bundleRoot $bundleTarget
            if (-not (Test-Path -LiteralPath $bundleDirectory -PathType Container)) {
                throw "$targetTriple 构建结束，但未找到 $bundleTarget 产物目录：$bundleDirectory"
            }

            $artifactFilter = if ($bundleTarget -eq "nsis") { "*.exe" } else { "*.msi" }
            $artifacts = @(Get-ChildItem -LiteralPath $bundleDirectory -File -Recurse -Filter $artifactFilter)
            if ($artifacts.Count -eq 0) {
                throw "$targetTriple 构建结束，但 $bundleTarget 产物目录为空：$bundleDirectory"
            }
            $targetArtifacts += $artifacts
        }

        Write-Host "$targetTriple 安装包：" -ForegroundColor Green
        foreach ($artifact in $targetArtifacts) {
            Write-Host "  $($artifact.FullName)"
        }
    }
} finally {
    Pop-Location
}

Write-Host "Windows Tauri 打包完成。" -ForegroundColor Green

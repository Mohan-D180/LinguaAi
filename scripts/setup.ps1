$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw 'Node.js 20 or newer is required. Install it from https://nodejs.org/ and rerun this script.'
    }
    & $winget.Source install --id OpenJS.NodeJS.LTS --exact --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        throw 'Node.js installation failed. Review the installer output and rerun this script.'
    }
    $nodePath = 'C:\Program Files\nodejs'
    if (Test-Path (Join-Path $nodePath 'node.exe')) {
        $env:Path = "$nodePath;$env:Path"
    }
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        throw 'Node.js was installed, but this terminal cannot find node.exe. Restart PowerShell and rerun this script.'
    }
}
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) {
    throw 'Node.js 20 or newer is required. Upgrade Node.js and rerun this script.'
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw 'Docker is not installed and winget is unavailable. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and rerun this script.'
    }
    & $winget.Source install --id Docker.DockerDesktop --exact --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker Desktop installation failed. Review the installer output and rerun this script.'
    }
}

$dockerPath = 'C:\Program Files\Docker\Docker\resources\bin'
if (-not (Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $dockerPath 'docker.exe'))) {
    $env:Path = "$dockerPath;$env:Path"
}
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    throw 'Docker was installed, but this terminal cannot find docker.exe. Restart PowerShell and rerun this script.'
}

$wslVersion = (& wsl.exe --version 2>&1 | Out-String)
if ($wslVersion -match 'not installed') {
    & wsl.exe --install --no-distribution
    if ($LASTEXITCODE -ne 0) {
        throw 'WSL installation failed. Run this script from an Administrator PowerShell terminal.'
    }
    throw 'WSL was installed. Restart Windows, start Docker Desktop, then rerun this script.'
}

$desktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
if (-not (Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue)) {
    if (-not (Test-Path $desktop)) {
        throw 'Docker Desktop was not found. Install Docker Desktop and rerun this script.'
    }
    Start-Process -FilePath $desktop
}

Write-Host 'Waiting for Docker Desktop...'
$dockerReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & $docker.Source info --format '{{.ServerVersion}}' 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $dockerReady = $true
        break
    }
    Start-Sleep -Seconds 5
}
if (-not $dockerReady) {
    throw 'Docker Desktop did not start. Open Docker Desktop, resolve any WSL or restart prompts, then rerun this script.'
}

foreach ($file in @('.env', 'server\.env', 'client\.env')) {
    $destination = Join-Path $root $file
    if (-not (Test-Path $destination)) {
        Copy-Item (Join-Path $root "$file.example") $destination
    }
}

$serverEnvPath = Join-Path $root 'server\.env'
$serverEnvLines = [System.IO.File]::ReadAllLines($serverEnvPath)
$serverEnv = New-Object 'System.Collections.Generic.List[string]'
foreach ($line in $serverEnvLines) {
    if ($line -match '^(AI_PROVIDER|OLLAMA_BASE_URL|OLLAMA_MODEL|OLLAMA_TIMEOUT_MS|GEMINI_API_KEY|GEMINI_MODEL)=') {
        continue
    }
    $serverEnv.Add($line)
}
$serverEnv.Add('AI_PROVIDER=ollama')
$serverEnv.Add('OLLAMA_BASE_URL=http://localhost:11434')
$serverEnv.Add('OLLAMA_MODEL=llama3.2:3b')
$serverEnv.Add('OLLAMA_TIMEOUT_MS=180000')
[System.IO.File]::WriteAllLines($serverEnvPath, $serverEnv, (New-Object System.Text.UTF8Encoding($false)))

npm install
if ($LASTEXITCODE -ne 0) {
    throw 'npm install failed.'
}

Write-Host 'Building the API and starting PostgreSQL, Ollama, and the model initializer. The first run downloads the model.'
& $docker.Source compose up -d --build
if ($LASTEXITCODE -ne 0) {
    throw 'Docker Compose failed. Review docker compose logs and rerun this script.'
}

Write-Host 'Waiting for the API and local model...'
$apiReady = $false
for ($attempt = 0; $attempt -lt 180; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri 'http://localhost:4000/api/v1/health' -TimeoutSec 5
        if ($health.status -eq 'ok' -and $health.ai.status -eq 'ready') {
            $apiReady = $true
            break
        }
    } catch {}
    Start-Sleep -Seconds 5
}
if (-not $apiReady) {
    & $docker.Source compose ps
    throw 'The local AI API did not become ready. Review docker compose logs ollama ollama-init server.'
}

Write-Host 'Starting the web client. Open the Local URL printed by Vite when it is ready.'
npm run dev -w client

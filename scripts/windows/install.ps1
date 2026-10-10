# npm run local:install — deixa o Arca Assistant rodando sozinho neste PC (Windows).
#  1. Cria a tarefa "Arca Assistant" no Agendador: sobe o app (oculto) sempre que você faz login.
#  2. Se o Tailscale estiver instalado, publica o app SÓ na sua rede Tailscale (tailscale serve),
#     com HTTPS, para abrir no celular/notebook. Nada fica exposto na internet.
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$node = (Get-Command node -ErrorAction Stop).Source
$port = if ($env:PORT) { $env:PORT } else { "3001" }
$taskName = "Arca Assistant"

Write-Host "Pasta do app: $root"

# --- tarefa no login (roda como você, para usar o login local do Claude/Codex) ---
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\scripts\windows\run-hidden.ps1`"" `
  -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "Arca Assistant em http://127.0.0.1:$port (node $root\scripts\local.mjs)" -Force | Out-Null
Write-Host "Tarefa '$taskName' criada: o app sobe sozinho quando voce faz login."

Start-ScheduledTask -TaskName $taskName
Write-Host "Iniciando (a primeira compilacao leva alguns segundos)..."
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 2
  try { Invoke-WebRequest "http://127.0.0.1:$port/api/state" -UseBasicParsing -TimeoutSec 2 | Out-Null; $ok = $true; break } catch { }
}
if ($ok) { Write-Host "App no ar: http://localhost:$port" } else { Write-Warning "O app ainda nao respondeu. Veja data\logs\server.log" }

# --- acesso pelos seus outros aparelhos via Tailscale ---
$ts = Get-Command tailscale -ErrorAction SilentlyContinue
if (-not $ts) {
  Write-Host "Tailscale nao encontrado. Para abrir no celular, instale em https://tailscale.com/download e rode este comando de novo."
  exit 0
}
& tailscale serve --bg --https=443 "http://127.0.0.1:$port"
if ($LASTEXITCODE -ne 0) {
  Write-Warning "O 'tailscale serve' nao foi configurado. Se ele pediu para habilitar HTTPS na sua rede, abra o link acima, habilite e rode 'npm run local:install' de novo."
  exit 0
}
$dns = ((& tailscale status --json) | ConvertFrom-Json).Self.DNSName.TrimEnd(".")
Write-Host ""
Write-Host "Pronto! Nos seus aparelhos com Tailscale: https://$dns"
Write-Host "(so a sua rede Tailscale enxerga esse endereco)"

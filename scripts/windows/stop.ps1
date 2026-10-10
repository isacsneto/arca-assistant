# npm run local:stop — para o app rodando em segundo plano (a tarefa volta a subir no próximo login).
# npm run local:stop -- -Uninstall — também remove a tarefa e o "tailscale serve".
param([switch]$Uninstall)
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$port = if ($env:PORT) { $env:PORT } else { "3001" }
$taskName = "Arca Assistant"

Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
# O laço do run-hidden.ps1 religaria o app: encerra o que tenha sobrado da tarefa (conhost/powershell).
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'conhost.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*run-hidden.ps1*" } |
  ForEach-Object { & taskkill /PID $_.ProcessId /T /F *> $null }
$pidFile = Join-Path $root "data\local.pid"
if (Test-Path $pidFile) {
  $procId = Get-Content $pidFile
  & taskkill /PID $procId /T /F *> $null
  Remove-Item $pidFile -ErrorAction SilentlyContinue
}
# Servidor que tenha sobrado na porta (só se for o node deste app).
Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId = $($_.OwningProcess)"
  if ($p -and $p.Name -eq "node.exe" -and $p.CommandLine -like "*server/index.ts*") { & taskkill /PID $p.ProcessId /T /F *> $null }
}
Write-Host "Arca Assistant parado."

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  if (Get-Command tailscale -ErrorAction SilentlyContinue) { & tailscale serve --https=443 off *> $null }
  Write-Host "Tarefa '$taskName' e 'tailscale serve' removidos."
}

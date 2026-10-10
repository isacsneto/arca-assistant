# Chamado pela tarefa "Arca Assistant" (via conhost --headless, sem janela). Roda o app até a tarefa
# ser parada ("npm run local:stop") ou você sair da conta. Se o supervisor (local.mjs) sair por
# qualquer motivo, sobe de novo em 10 s, como o KeepAlive do macOS e o Restart=always do Linux.
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $root
while ($true) {
  & node "$root\scripts\local.mjs" --service *> $null
  Start-Sleep -Seconds 10
}

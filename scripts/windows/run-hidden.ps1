# Chamado pela tarefa "Arca Assistant" (janela oculta). Roda o app até ele ser parado.
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $root
& node "$root\scripts\local.mjs" *> $null

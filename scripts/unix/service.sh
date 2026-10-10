#!/usr/bin/env bash
# Deixa o Arca Assistant rodando sozinho no macOS (LaunchAgent) ou no Linux (systemd do usuário)
# e, se o Tailscale estiver instalado, publica o app só na sua rede Tailscale (tailscale serve).
#   scripts/unix/service.sh install | stop | uninstall
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NODE="$(command -v node)"
PORT="${PORT:-3001}"
LABEL="com.arca-assistant"
OS="$(uname -s)"

tailscale_bin() {
  if command -v tailscale >/dev/null 2>&1; then command -v tailscale
  elif [ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]; then echo "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
  fi
}

wait_up() {
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:$PORT/api/state" >/dev/null 2>&1; then echo "App no ar: http://localhost:$PORT"; return 0; fi
    sleep 2
  done
  echo "O app ainda não respondeu. Veja data/logs/server.log" >&2
}

serve() {
  local ts; ts="$(tailscale_bin || true)"
  if [ -z "$ts" ]; then
    echo "Tailscale não encontrado. Para abrir no celular, instale em https://tailscale.com/download e rode de novo."
    return 0
  fi
  if ! "$ts" serve --bg --https=443 "http://127.0.0.1:$PORT"; then
    echo "O 'tailscale serve' não foi configurado. Se pediu para habilitar HTTPS, abra o link acima e rode de novo." >&2
    [ "$OS" = "Linux" ] && echo "No Linux, talvez precise: sudo tailscale set --operator=\$USER" >&2
    return 0
  fi
  local dns; dns="$("$ts" status --json | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,"")))')"
  echo
  echo "Pronto! Nos seus aparelhos com Tailscale: https://$dns"
  echo "(só a sua rede Tailscale enxerga esse endereço)"
}

mac_plist="$HOME/Library/LaunchAgents/$LABEL.plist"
linux_unit="$HOME/.config/systemd/user/arca-assistant.service"

install() {
  echo "Pasta do app: $ROOT"
  if [ "$OS" = "Darwin" ]; then
    mkdir -p "$(dirname "$mac_plist")"
    cat > "$mac_plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$ROOT/scripts/local.mjs</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NODE"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string><key>PORT</key><string>$PORT</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>
PLIST
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$mac_plist"
    echo "LaunchAgent '$LABEL' criado: o app sobe sozinho quando você faz login."
  elif [ "$OS" = "Linux" ]; then
    mkdir -p "$(dirname "$linux_unit")"
    cat > "$linux_unit" <<UNIT
[Unit]
Description=Arca Assistant
After=network-online.target

[Service]
WorkingDirectory=$ROOT
Environment=PORT=$PORT
Environment=PATH=$(dirname "$NODE"):/usr/local/bin:/usr/bin:/bin
ExecStart=$NODE $ROOT/scripts/local.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT
    systemctl --user daemon-reload
    systemctl --user enable --now arca-assistant.service
    echo "Serviço 'arca-assistant' (systemd do usuário) criado e iniciado."
    echo "Para rodar mesmo sem você logado: sudo loginctl enable-linger $USER"
  else
    echo "Sistema não suportado: $OS" >&2; exit 1
  fi
  wait_up
  serve
}

stop() {
  if [ "$OS" = "Darwin" ]; then launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  else systemctl --user stop arca-assistant.service 2>/dev/null || true; fi
  echo "Arca Assistant parado (volta no próximo login; 'npm run local:install' religa agora)."
}

uninstall() {
  stop
  if [ "$OS" = "Darwin" ]; then rm -f "$mac_plist"
  else
    systemctl --user disable arca-assistant.service 2>/dev/null || true
    rm -f "$linux_unit"; systemctl --user daemon-reload
  fi
  local ts; ts="$(tailscale_bin || true)"
  [ -n "$ts" ] && "$ts" serve --https=443 off >/dev/null 2>&1 || true
  echo "Inicialização automática e 'tailscale serve' removidos."
}

case "${1:-install}" in
  install) install ;;
  stop) stop ;;
  uninstall) uninstall ;;
  *) echo "uso: $0 install|stop|uninstall" >&2; exit 1 ;;
esac

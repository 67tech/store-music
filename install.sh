#!/bin/bash
# Store Music Manager - Interactive Installer
# Tested on Ubuntu 22.04/24.04, Debian 12, Raspberry Pi OS
# Usage: sudo bash install.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

clear
echo -e "${CYAN}"
echo "  ____  _                 __  __           _      "
echo " / ___|| |_ ___  _ __ ___|  \/  |_   _ ___(_) ___ "
echo " \\___ \\| __/ _ \\| '__/ _ \\ |\\/| | | | / __| |/ __|"
echo "  ___) | || (_) | | |  __/ |  | | |_| \\__ \\ | (__ "
echo " |____/ \\__\\___/|_|  \\___|_|  |_|\\__,_|___/_|\\___|"
echo ""
echo -e "  ${BOLD}Store Music Manager - Instalator${NC}"
echo ""

# Check root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Uruchom skrypt jako root: sudo bash install.sh${NC}"
  exit 1
fi

ACTUAL_USER="${SUDO_USER:-$USER}"

# Detect OS
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_ID=$ID
  OS_NAME=$PRETTY_NAME
else
  OS_ID="unknown"
  OS_NAME="Nieznany"
fi
echo -e "  System: ${GREEN}${OS_NAME}${NC}"
echo -e "  Architektura: ${GREEN}$(uname -m)${NC}"
echo ""

# ============================================
# STEP 1: Interactive configuration
# ============================================
echo -e "${BLUE}${BOLD}=== Konfiguracja ===${NC}"
echo ""

# Install directory
read -p "$(echo -e ${CYAN}Katalog instalacji${NC} [/opt/store-music]: )" INSTALL_DIR
INSTALL_DIR=${INSTALL_DIR:-/opt/store-music}

# Port
read -p "$(echo -e ${CYAN}Port aplikacji${NC} [3000]: )" APP_PORT
APP_PORT=${APP_PORT:-3000}

# Music directory
read -p "$(echo -e ${CYAN}Katalog z muzyka${NC} [${INSTALL_DIR}/data/audio]: )" MUSIC_DIR
MUSIC_DIR=${MUSIC_DIR:-${INSTALL_DIR}/data/audio}

# System user
read -p "$(echo -e ${CYAN}Uzytkownik systemowy${NC} [storemusic]: )" APP_USER
APP_USER=${APP_USER:-storemusic}

# Admin
echo ""
echo -e "${BLUE}Konto administratora:${NC}"
read -p "  Login [admin]: " ADMIN_USER
ADMIN_USER=${ADMIN_USER:-admin}
read -sp "  Haslo [admin]: " ADMIN_PASS
ADMIN_PASS=${ADMIN_PASS:-admin}
echo ""

# Autostart
echo ""
read -p "$(echo -e ${CYAN}Autostart przy starcie systemu?${NC} [T/n]: )" AUTOSTART
AUTOSTART=${AUTOSTART:-T}

# Audio output
echo ""
echo -e "${BLUE}Wyjscie audio:${NC}"
echo "  1) Domyslne (auto)"
echo "  2) HDMI"
echo "  3) Jack 3.5mm / Analog"
echo "  4) USB Audio"
echo "  5) Bluetooth (wymaga sparowania)"
read -p "  Wybor [1]: " AUDIO_OUT
AUDIO_OUT=${AUDIO_OUT:-1}

# TTS engine
echo ""
echo -e "${BLUE}Silnik TTS (text-to-speech):${NC}"
echo "  1) Google TTS (wymaga internetu)"
echo "  2) Edge TTS (wymaga internetu, lepsza jakosc)"
echo "  3) Piper TTS (offline, zainstaluje automatycznie)"
echo "  4) Bez TTS"
read -p "  Wybor [1]: " TTS_ENGINE
TTS_ENGINE=${TTS_ENGINE:-1}

# ElevenLabs (optional)
echo ""
read -p "$(echo -e ${CYAN}Czy masz klucz API ElevenLabs?${NC} [n/T]: )" HAS_ELEVEN
HAS_ELEVEN=${HAS_ELEVEN:-n}
ELEVEN_KEY=""
if [[ "$HAS_ELEVEN" == "t" || "$HAS_ELEVEN" == "T" || "$HAS_ELEVEN" == "y" || "$HAS_ELEVEN" == "Y" ]]; then
  read -p "  Klucz API ElevenLabs: " ELEVEN_KEY
fi

# ============================================
# Summary
# ============================================
echo ""
echo -e "${BLUE}${BOLD}=== Podsumowanie ===${NC}"
echo -e "  Katalog:      ${GREEN}${INSTALL_DIR}${NC}"
echo -e "  Port:         ${GREEN}${APP_PORT}${NC}"
echo -e "  Muzyka:       ${GREEN}${MUSIC_DIR}${NC}"
echo -e "  Uzytkownik:   ${GREEN}${APP_USER}${NC}"
echo -e "  Admin:        ${GREEN}${ADMIN_USER}${NC}"
echo -e "  Autostart:    ${GREEN}${AUTOSTART}${NC}"

case $AUDIO_OUT in
  2) echo -e "  Audio:        ${GREEN}HDMI${NC}" ;;
  3) echo -e "  Audio:        ${GREEN}Jack 3.5mm${NC}" ;;
  4) echo -e "  Audio:        ${GREEN}USB Audio${NC}" ;;
  5) echo -e "  Audio:        ${GREEN}Bluetooth${NC}" ;;
  *) echo -e "  Audio:        ${GREEN}Auto${NC}" ;;
esac

case $TTS_ENGINE in
  2) echo -e "  TTS:          ${GREEN}Edge TTS${NC}" ;;
  3) echo -e "  TTS:          ${GREEN}Piper (offline)${NC}" ;;
  4) echo -e "  TTS:          ${GREEN}Wylaczony${NC}" ;;
  *) echo -e "  TTS:          ${GREEN}Google TTS${NC}" ;;
esac

echo ""
read -p "$(echo -e ${BOLD}Rozpoczac instalacje? [T/n]:${NC} )" CONFIRM
CONFIRM=${CONFIRM:-T}
if [[ "$CONFIRM" == "n" || "$CONFIRM" == "N" ]]; then
  echo "Anulowano."
  exit 0
fi

echo ""
echo -e "${GREEN}${BOLD}>>> Instalacja...${NC}"

# ============================================
# STEP 2: System dependencies
# ============================================
echo ""
echo -e "${BLUE}[1/8] Pakiety systemowe...${NC}"

if [[ "$OS_ID" == "ubuntu" || "$OS_ID" == "debian" || "$OS_ID" == "raspbian" ]]; then
  apt-get update -qq > /dev/null 2>&1
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    curl git mpv ffmpeg build-essential python3 alsa-utils > /dev/null 2>&1
elif [[ "$OS_ID" == "fedora" || "$OS_ID" == "centos" || "$OS_ID" == "rhel" ]]; then
  dnf install -y -q curl git mpv ffmpeg gcc-c++ make python3 alsa-utils > /dev/null 2>&1
elif [[ "$OS_ID" == "arch" || "$OS_ID" == "manjaro" ]]; then
  pacman -Sy --noconfirm --quiet curl git mpv ffmpeg base-devel python alsa-utils > /dev/null 2>&1
else
  echo -e "${YELLOW}  Nieznany system. Upewnij sie, ze masz: curl, git, mpv, ffmpeg, build-essential, python3${NC}"
fi
echo -e "${GREEN}  OK${NC}"

# ============================================
# STEP 3: Node.js
# ============================================
echo -e "${BLUE}[2/8] Node.js...${NC}"

NEED_NODE=false
if command -v node &> /dev/null; then
  NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VER" -ge 18 ]; then
    echo -e "${GREEN}  Juz zainstalowany: $(node -v)${NC}"
  else
    NEED_NODE=true
  fi
else
  NEED_NODE=true
fi

if [ "$NEED_NODE" = true ]; then
  echo "  Instaluje Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null 2>&1
  echo -e "${GREEN}  Zainstalowano: $(node -v)${NC}"
fi

# ============================================
# STEP 4: Piper TTS (if selected)
# ============================================
if [ "$TTS_ENGINE" = "3" ]; then
  echo -e "${BLUE}[3/8] Piper TTS (offline)...${NC}"
  ARCH=$(dpkg --print-architecture 2>/dev/null || uname -m)
  PIPER_VERSION="2023.11.14-2"

  case $ARCH in
    amd64|x86_64) PIPER_ARCH="amd64" ;;
    arm64|aarch64) PIPER_ARCH="arm64" ;;
    armhf|armv7l) PIPER_ARCH="armv7l" ;;
    *) echo -e "${YELLOW}  Architektura $ARCH nie jest wspierana przez Piper. Pomijam.${NC}"; TTS_ENGINE=1 ;;
  esac

  if [ "$TTS_ENGINE" = "3" ]; then
    wget -q "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_${PIPER_ARCH}.tar.gz" -O /tmp/piper.tar.gz
    tar -xzf /tmp/piper.tar.gz -C /usr/local/bin/
    rm -f /tmp/piper.tar.gz

    mkdir -p /usr/local/share/piper-voices
    wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/main/pl/pl_PL/darkman/medium/pl_PL-darkman-medium.onnx" \
      -O /usr/local/share/piper-voices/pl.onnx
    wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/main/pl/pl_PL/darkman/medium/pl_PL-darkman-medium.onnx.json" \
      -O /usr/local/share/piper-voices/pl.onnx.json
    echo -e "${GREEN}  Piper TTS zainstalowany z polskim glosem${NC}"
  fi
else
  echo -e "${BLUE}[3/8] Piper TTS — pominieto${NC}"
fi

# ============================================
# STEP 5: User & directories
# ============================================
echo -e "${BLUE}[4/8] Uzytkownik i katalogi...${NC}"

if ! id "$APP_USER" &>/dev/null; then
  useradd -r -m -s /bin/bash "$APP_USER" 2>/dev/null || true
fi
usermod -aG audio "$APP_USER" 2>/dev/null || true

mkdir -p "$INSTALL_DIR"
mkdir -p "$MUSIC_DIR"
mkdir -p "${INSTALL_DIR}/data/announcements"
mkdir -p "${INSTALL_DIR}/data/uploads"
mkdir -p "${INSTALL_DIR}/data/tts-cache"
mkdir -p "${INSTALL_DIR}/data/backups"
mkdir -p "${INSTALL_DIR}/data/matchday"

echo -e "${GREEN}  OK${NC}"

# ============================================
# STEP 6: Copy files & npm install
# ============================================
echo -e "${BLUE}[5/8] Kopiowanie aplikacji...${NC}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cp "$SCRIPT_DIR/server.js" "$INSTALL_DIR/"
cp "$SCRIPT_DIR/package.json" "$INSTALL_DIR/"
cp -r "$SCRIPT_DIR/src" "$INSTALL_DIR/"
cp -r "$SCRIPT_DIR/public" "$INSTALL_DIR/"

# .env file
cat > "${INSTALL_DIR}/.env" <<EOF
PORT=${APP_PORT}
NODE_ENV=production
EOF

chown -R "$APP_USER":"$APP_USER" "$INSTALL_DIR"

echo -e "${GREEN}  OK${NC}"

echo -e "${BLUE}[6/8] Instalacja zaleznosci npm...${NC}"

cd "$INSTALL_DIR"
sudo -u "$APP_USER" npm install --production 2>&1 | tail -3

# Edge TTS pip package
if [ "$TTS_ENGINE" = "2" ]; then
  pip3 install edge-tts 2>/dev/null || pip install edge-tts 2>/dev/null || true
fi

echo -e "${GREEN}  OK${NC}"

# ============================================
# STEP 7: Audio configuration
# ============================================
echo -e "${BLUE}[7/8] Konfiguracja audio...${NC}"

MPV_CONF_DIR="/home/${APP_USER}/.config/mpv"
mkdir -p "$MPV_CONF_DIR"

case $AUDIO_OUT in
  2)
    echo -e "ao=alsa\naudio-device=alsa/hdmi" > "$MPV_CONF_DIR/mpv.conf"
    echo -e "  ${GREEN}HDMI${NC}"
    ;;
  3)
    echo -e "ao=alsa\naudio-device=alsa/default" > "$MPV_CONF_DIR/mpv.conf"
    echo -e "  ${GREEN}Jack 3.5mm${NC}"
    ;;
  4)
    echo -e "ao=alsa" > "$MPV_CONF_DIR/mpv.conf"
    echo -e "  ${GREEN}USB Audio (auto)${NC}"
    ;;
  5)
    echo -e "ao=pulse" > "$MPV_CONF_DIR/mpv.conf"
    echo -e "  ${GREEN}Bluetooth (pulseaudio)${NC}"
    apt-get install -y -qq pulseaudio pulseaudio-module-bluetooth bluez > /dev/null 2>&1 || true
    ;;
  *)
    echo -e "ao=pulse" > "$MPV_CONF_DIR/mpv.conf"
    echo -e "  ${GREEN}Auto${NC}"
    ;;
esac

chown -R "$APP_USER":"$APP_USER" "/home/${APP_USER}/.config"

# Set initial settings via env vars for first run
TTS_ENGINE_NAME="google"
case $TTS_ENGINE in
  2) TTS_ENGINE_NAME="edge" ;;
  3) TTS_ENGINE_NAME="piper" ;;
  4) TTS_ENGINE_NAME="" ;;
  *) TTS_ENGINE_NAME="google" ;;
esac

# Write initial config to .env
cat >> "${INSTALL_DIR}/.env" <<EOF
ADMIN_USER=${ADMIN_USER}
ADMIN_PASS=${ADMIN_PASS}
TTS_ENGINE=${TTS_ENGINE_NAME}
ELEVENLABS_API_KEY=${ELEVEN_KEY}
MUSIC_DIR=${MUSIC_DIR}
EOF

echo -e "${GREEN}  OK${NC}"

# ============================================
# STEP 8: Systemd service
# ============================================
echo -e "${BLUE}[8/8] Serwis systemd...${NC}"

cat > /etc/systemd/system/store-music.service <<EOF
[Unit]
Description=Store Music Manager
After=network.target sound.target
Wants=pulseaudio.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=XDG_RUNTIME_DIR=/run/user/$(id -u ${APP_USER})

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

if [[ "$AUTOSTART" != "n" && "$AUTOSTART" != "N" ]]; then
  systemctl enable store-music > /dev/null 2>&1
  echo -e "  ${GREEN}Autostart wlaczony${NC}"
fi

# Start
systemctl start store-music
sleep 3

if systemctl is-active --quiet store-music; then
  echo -e "  ${GREEN}Serwis uruchomiony!${NC}"
else
  echo -e "  ${YELLOW}Serwis nie uruchomil sie. Sprawdz: journalctl -u store-music -n 20${NC}"
fi

# ============================================
# Done!
# ============================================
IP_ADDR=$(hostname -I 2>/dev/null | awk '{print $1}')

echo ""
echo -e "${GREEN}${BOLD}=================================================${NC}"
echo -e "${GREEN}${BOLD}  Instalacja zakonczona pomyslnie!${NC}"
echo -e "${GREEN}${BOLD}=================================================${NC}"
echo ""
echo -e "  ${BOLD}Panel:${NC}     ${CYAN}http://${IP_ADDR}:${APP_PORT}${NC}"
echo -e "  ${BOLD}Login:${NC}     ${CYAN}${ADMIN_USER}${NC}"
echo -e "  ${BOLD}Haslo:${NC}     ${CYAN}${ADMIN_PASS}${NC}"
echo ""
echo -e "  ${BOLD}Katalog:${NC}   ${INSTALL_DIR}"
echo -e "  ${BOLD}Muzyka:${NC}    ${MUSIC_DIR}"
echo -e "  ${BOLD}Logi:${NC}      journalctl -u store-music -f"
echo ""
echo -e "  ${BOLD}Komendy:${NC}"
echo -e "    sudo systemctl status store-music    - status"
echo -e "    sudo systemctl restart store-music   - restart"
echo -e "    sudo systemctl stop store-music      - zatrzymaj"
echo ""
echo -e "  ${BOLD}Nastepne kroki:${NC}"
echo -e "    1. Skopiuj pliki MP3 do: ${MUSIC_DIR}"
echo -e "    2. Otworz panel w przegladarce: http://${IP_ADDR}:${APP_PORT}"
echo -e "    3. Przeskanuj biblioteke muzyki w zakladce 'Utwory'"
echo -e "    4. Utworz pierwsza playliste i przypisz utwory"
echo ""

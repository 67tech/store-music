#!/bin/bash
set -e

echo "=== Store Music Manager - Installation ==="
echo ""

# Check if running as root for system packages
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (sudo) for system package installation"
  exit 1
fi

# Detect OS
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
else
  echo "Cannot detect OS"
  exit 1
fi

echo "[1/6] Installing system dependencies..."

if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
  apt-get update -qq
  apt-get install -y -qq mpv ffmpeg alsa-utils pulseaudio

  # Optional: Install Piper TTS
  echo ""
  read -p "Install Piper TTS for offline text-to-speech? (y/N): " install_piper
  if [ "$install_piper" = "y" ] || [ "$install_piper" = "Y" ]; then
    echo "Installing Piper TTS..."
    # Download latest piper binary
    PIPER_VERSION="2023.11.14-2"
    ARCH=$(dpkg --print-architecture)
    if [ "$ARCH" = "amd64" ]; then
      PIPER_ARCH="amd64"
    elif [ "$ARCH" = "arm64" ]; then
      PIPER_ARCH="arm64"
    elif [ "$ARCH" = "armhf" ]; then
      PIPER_ARCH="armv7l"
    else
      echo "Unsupported architecture for Piper: $ARCH"
      echo "Skipping Piper installation"
      install_piper="n"
    fi

    if [ "$install_piper" = "y" ] || [ "$install_piper" = "Y" ]; then
      wget -q "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_${PIPER_ARCH}.tar.gz" -O /tmp/piper.tar.gz
      tar -xzf /tmp/piper.tar.gz -C /usr/local/bin/
      rm /tmp/piper.tar.gz

      # Download Polish voice model
      echo "Downloading Polish voice model for Piper..."
      mkdir -p /usr/local/share/piper-voices
      wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/main/pl/pl_PL/darkman/medium/pl_PL-darkman-medium.onnx" -O /usr/local/share/piper-voices/pl.onnx
      wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/main/pl/pl_PL/darkman/medium/pl_PL-darkman-medium.onnx.json" -O /usr/local/share/piper-voices/pl.onnx.json
      echo "Piper TTS installed successfully"
    fi
  fi
else
  echo "Unsupported OS: $OS"
  echo "Please install manually: mpv, ffmpeg, alsa-utils"
  exit 1
fi

echo ""
echo "[2/6] Checking audio output..."
echo ""

# List audio devices
echo "Available audio devices:"
aplay -l 2>/dev/null || echo "No ALSA devices found"
echo ""

# Test if we can detect a sound card
if ! aplay -l &>/dev/null; then
  echo "WARNING: No sound card detected!"
  echo "Make sure your audio drivers are installed."
  echo ""
  echo "Common audio driver packages:"
  echo "  - USB audio: should work out of the box"
  echo "  - Intel HDA: sudo apt install firmware-intel-sound (Debian) or linux-firmware (Ubuntu)"
  echo "  - PulseAudio: sudo apt install pulseaudio pulseaudio-utils"
  echo ""
  read -p "Continue anyway? (y/N): " cont
  if [ "$cont" != "y" ] && [ "$cont" != "Y" ]; then
    exit 1
  fi
fi

echo "[3/6] Checking Node.js..."
if ! command -v node &>/dev/null; then
  echo "Node.js not found. Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"

echo ""
echo "[4/6] Installing npm dependencies..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
npm install --production

echo ""
echo "[5/6] Creating data directories..."
mkdir -p data/audio data/announcements data/tts-cache

echo ""
echo "[6/6] Setting up systemd service..."

# Determine the user who will run the service
ACTUAL_USER="${SUDO_USER:-$USER}"

cat > /etc/systemd/system/store-music.service << EOF
[Unit]
Description=Store Music Manager
After=network.target sound.target
Wants=pulseaudio.service

[Service]
Type=simple
User=${ACTUAL_USER}
WorkingDirectory=${SCRIPT_DIR}
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000
# PulseAudio needs XDG_RUNTIME_DIR
Environment=XDG_RUNTIME_DIR=/run/user/$(id -u ${ACTUAL_USER})

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable store-music

echo ""
echo "=== Installation complete! ==="
echo ""
echo "Audio setup tips:"
echo "  - List audio outputs: aplay -l"
echo "  - Test audio: speaker-test -t wav -c 2"
echo "  - Set default output: pactl set-default-sink <sink_name>"
echo "  - List PulseAudio sinks: pactl list short sinks"
echo ""
echo "Start the service:"
echo "  sudo systemctl start store-music"
echo ""
echo "View logs:"
echo "  journalctl -u store-music -f"
echo ""
echo "Access the panel:"
echo "  http://localhost:3000"
echo "  http://$(hostname -I | awk '{print $1}'):3000"
echo ""
echo "To configure mpv audio output, create ~/.config/mpv/mpv.conf:"
echo "  ao=pulse"
echo "  audio-device=auto"
echo ""

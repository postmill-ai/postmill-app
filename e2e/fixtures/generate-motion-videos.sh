#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

make_video() {
  local output=$1
  local codec=$2
  local background=$3
  local box=$4
  local extra_args=()

  if [[ $codec == libvpx-vp9 ]]; then
    extra_args=(-b:v 0 -crf 42 -row-mt 1)
  else
    extra_args=(-crf 30 -preset veryfast -pix_fmt yuv420p -movflags +faststart)
  fi

  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=${background}:s=720x1280:r=24:d=4" \
    -vf "drawbox=x=40+mod(t*180\,460):y=420:w=220:h=220:color=${box}:t=fill,drawbox=x=0:y=0:w=720:h=1280:color=white@0.08:t=8" \
    -an -c:v "$codec" "${extra_args[@]}" "$output"
}

make_video motion.mp4 libx264 0x102040 0xffcc00
make_video replacement.webm libvpx-vp9 0x701020 0x40e0ff
ffmpeg -hide_banner -loglevel error -y -i motion.mp4 -c copy -movflags -faststart motion-rear-moov.mp4

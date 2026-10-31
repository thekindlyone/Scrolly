#!/usr/bin/env bash
# Real-time suite for the current script (4 min each, 4x CPU throttle ~ phone).
# Two runs at a time; results in out/runs/<name>/ and out/<name>.log.
cd "$(dirname "$0")"
P=${PREFIX:-v32}
EA=the-extras-academy-survival-guide/0003
SL=Solo-Leveling-Ragnarok/0001
run() { node run.js --secs 240 --cpu 4 --fast 200 "$@" > "out/${@: -1}.log" 2>&1; }
run --chapter $EA --auto 2 --speed 2 --name $P-ea-a2-s2 & run --chapter $SL --auto 2 --speed 2 --name $P-sl-a2-s2; wait
run --chapter $EA --auto 3 --speed 2 --name $P-ea-a3-s2 & run --chapter $EA --auto 2 --speed 4 --name $P-ea-a2-s4; wait
run --chapter $SL --auto 0 --speed 2 --name $P-sl-a0-s2 & run --chapter $SL --auto 3 --speed 3 --name $P-sl-a3-s3; wait

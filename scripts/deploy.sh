#!/bin/bash
set -e
set -o pipefail
rsync -SavLP dist node@paint.liveviews.cc:~/workspace/github.com/beenotung/live-paint

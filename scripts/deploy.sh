#!/bin/bash
set -e
set -o pipefail

source scripts/config

npm run build
rsync -SavLPz \
  public \
  build \
  dist \
  package.json \
  "$user@$host:$root_dir"
ssh "$user@$host" " \
source ~/.nvm/nvm.sh \
&& set -x \\
&& cd $root_dir \
&& pnpm i -r \
&& pm2 reload $pm2_name \
"

#!/bin/sh
# ANT IDE entrypoint dispatcher.
#   ANT_IDE_POOL_MODE=true  → Track B: claim-watcher (Redis polling → mount → exec openvscode-server)
#   else                    → Track A default: openvscode-server passthrough
set -e
if [ "${ANT_IDE_POOL_MODE:-false}" = "true" ]; then
  exec /usr/local/bin/claim-watcher.sh "$@"
fi
exec /home/.openvscode-server/bin/openvscode-server "$@"

#!/bin/sh
# Pool member entrypoint. Two-stage (filled out in Track B step B.4):
#   1) Block on Redis key `ant:ide:claim:wait:<podId>` (payload = mount spec JSON)
#   2) bind-mount /workspace + worktree mounts, umount /efs-root, exec openvscode-server
#
# Inputs (env, injected when ANT_IDE_POOL_MODE=true):
#   ANT_IDE_POOL_POD_ID    pool member id
#   ANT_IDE_REDIS_URL      redis url
#   ANT_IDE_BASE_PATH      e.g. /ide/pool/<podId>
#
# Track A: layer-only prelayer. Real polling + mount logic lands in Track B step B.4.
# Current behavior: passthrough to openvscode-server so a misconfigured pod still boots a usable IDE.
exec /home/.openvscode-server/bin/openvscode-server "$@"

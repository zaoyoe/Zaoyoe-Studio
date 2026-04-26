This directory contains the native macOS launchd files used to migrate the
local sub2api stack off Docker Desktop on this machine.

Services covered here:

- `com.zaoyoe.postgresql18`
- `com.zaoyoe.redis`
- `com.zaoyoe.sub2api`
- `com.zaoyoe.cli-proxy-api`
- `com.zaoyoe.cli-proxy-api-ui`

The files are machine-specific and point at the current user's absolute paths.

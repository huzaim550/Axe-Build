#!/bin/sh
set -e

# Cap the Gradle build JVM from outside every project: settings in
# GRADLE_USER_HOME take precedence over any project gradle.properties,
# so no uploaded project can blow past the container's memory budget.
GRADLE_USER_HOME="${GRADLE_USER_HOME:-/cache/gradle}"
mkdir -p "$GRADLE_USER_HOME"
cat > "$GRADLE_USER_HOME/gradle.properties" <<EOF
org.gradle.jvmargs=${GRADLE_JVM_ARGS:--Xmx3g -XX:MaxMetaspaceSize=1g}
org.gradle.daemon=false
EOF

exec node /repo/apps/worker/dist/index.js

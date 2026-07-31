#!/bin/sh
set -e

# Cap the Gradle build JVM from outside every project: settings in
# GRADLE_USER_HOME take precedence over any project gradle.properties,
# so no uploaded project can blow past the container's memory budget.
GRADLE_USER_HOME="${GRADLE_USER_HOME:-/cache/gradle}"
mkdir -p "$GRADLE_USER_HOME/init.d"
cat > "$GRADLE_USER_HOME/gradle.properties" <<EOF
org.gradle.jvmargs=${GRADLE_JVM_ARGS:--Xmx4g -XX:MaxMetaspaceSize=1g}
org.gradle.daemon=false
org.gradle.parallel=true
org.gradle.caching=true
EOF

# Disables Android lint for every build (see the script for why).
cp /repo/apps/worker/gradle/mybuild.init.gradle "$GRADLE_USER_HOME/init.d/"

# ccache dir lives on its own volume so repeat native compiles are near-free.
mkdir -p "${CCACHE_DIR:-/cache/ccache}"

exec node /repo/apps/worker/dist/index.js

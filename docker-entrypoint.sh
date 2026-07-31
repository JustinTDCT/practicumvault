#!/bin/sh
set -e
cd /app
./node_modules/.bin/prisma migrate deploy
exec su-exec nextjs:nodejs node server.js

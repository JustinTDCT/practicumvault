#!/bin/sh
set -e
cd /app
./node_modules/.bin/prisma db push
exec su-exec nextjs:nodejs node server.js

#!/bin/sh
SRC=$1
DEST=$2
NAME=backup-$(date -u +%Y%m%dT%H%M%SZ).tar.gz
mkdir $DEST
tar -czf $DEST/$NAME -C $SRC .
echo "backup done: $DEST/$NAME"

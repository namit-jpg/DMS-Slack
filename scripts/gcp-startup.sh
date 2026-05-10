#!/bin/bash
apt-get update -y
apt-get install -y curl git
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
mkdir -p /opt/dmsfa
chown -R ubuntu:ubuntu /opt/dmsfa
echo "App dir: /opt/dmsfa" > /opt/dmsfa/README.txt
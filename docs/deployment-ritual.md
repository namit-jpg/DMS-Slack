# DMSFA Deployment Ritual

Complete step-by-step guide to deploy the DMSFA Slack app to GCP Compute Engine.

> **Archived legacy procedure (2026-08-10):** The `dmsfa-server` instance was
> decommissioned after the Convex development rehearsal. This document is kept
> for rollback/reference only and must not be used as the current deployment
> path. See [the Convex migration plan](convex-migration-plan.md) for the
> verified serverless deployment status and the remaining production gates.

---

## GCP VM Info

| Field | Value |
|---|---|
| **Project** | `govfund-app` |
| **VM Name** | `dmsfa-server` |
| **Zone** | `us-central1-a` |
| **Machine** | `e2-small` |
| **External IP** | `34.45.111.128` |
| **Firewall tags** | `dmsfa-http` |
| **Open ports** | `tcp:3000` (health), `tcp:3001` (Slack HTTP) |
| **SSH user** | `namit` (your GCP account) |
| **App dir** | `/opt/dmsfa` |
| **Process mgr** | `pm2` (runs as root) |

## 1. Connect to VM

```bash
gcloud compute ssh dmsfa-server --zone=us-central1-a
```

## 2. Pull latest code & deploy

```bash
cd /opt/dmsfa
git checkout master
git pull origin master
npm run build
sudo pm2 restart dmsfa --update-env
```

## 3. Verify health

```bash
curl http://localhost:3000/
# Should return: {"status":"ok","clientMode":"REAL",...}
```

## 4. Check pm2 status

```bash
sudo pm2 status
# Should show "dmsfa" online with 0 restarts
sudo pm2 logs dmsfa --lines 20
```

## 5. SF CLI auth setup (after VM reboot)

The SF CLI auth files live in `/root/.sfdx/`. They must be present for `SALESFORCE_AUTH_MODE=SF_CLI`.

**If files are missing after reboot:**
```bash
# Copy from namit user to root
sudo mkdir -p /root/.sfdx
sudo cp /home/namit/.sfdx/rcg.dev@wd.in.json /root/.sfdx/
sudo cp /home/namit/.sfdx/alias.json /root/.sfdx/
sudo cp /home/namit/.sfdx/key.json /root/.sfdx/
sudo chmod 600 /root/.sfdx/*.json
```

## 6. ngrok tunnel

The Slack app needs a public HTTPS URL. ngrok provides this.

```bash
# Start ngrok
nohup ngrok http 3001 --log=stdout > /tmp/ngrok.log 2>&1 &

# Get the public URL
curl -s http://localhost:4040/api/tunnels | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['tunnels'][0]['public_url'])"
```

**After starting, update Slack app** with the new ngrok URL in:
- Slash Commands → `/dms` → Request URL
- Event Subscriptions → Request URL  
- Interactivity → Request URL

Use the format: `https://xxxx.ngrok-free.dev/slack/events`

## 7. Cron - SF auth refresh

Daily at 9am IST (3:30 UTC): refreshes the SF CLI token.

```bash
cat /etc/cron.d/sf-auth-refresh
# Should show: 30 3 * * * root /usr/bin/sf org display --target-org rcg-dms --json > /tmp/sf-auth-refresh.log 2>&1
```

## 8. Restart everything

```bash
# Stop all
sudo pm2 stop all

# Pull latest
cd /opt/dmsfa && git pull origin master && npm run build

# Start app
sudo pm2 start dist/server.js --name dmsfa --cwd /opt/dmsfa --time

# Start ngrok
nohup ngrok http 3001 --log=stdout > /tmp/ngrok.log 2>&1 &

# Verify
sleep 5 && curl http://localhost:3000/
```

## 9. View logs

```bash
sudo pm2 logs dmsfa --lines 50
tail -50 /root/.pm2/logs/dmsfa-error.log
tail -50 /root/.pm2/logs/dmsfa-out.log
```

## 10. .env on VM

```bash
cat /opt/dmsfa/.env
```

Key vars:
```
USE_MOCK_SALESFORCE=false
SALESFORCE_AUTH_MODE=SF_CLI
SALESFORCE_CLI_TARGET_ORG=rcg-dms
SLACK_SOCKET_MODE=false
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
```

## 11. Slack App

- **App ID**: `A0B2SAMT48G`
- **Settings URL**: https://api.slack.com/apps/A0B2SAMT48G
- **Slack manifest**: `manifest.json` in repo root
- **Workspace**: `warpdrivegridsandbox` (E095QSY1H8R)
- **Slack CLI auth**: `slack auth list`

## 12. Salesforce Org

- **Username**: `rcg.dev@wd.in`
- **Org ID**: `00Dam00001TdPgTEAV`
- **Instance**: `https://warpdrivercgdms-dev-ed.develop.my.salesforce.com`
- **API version**: v66.0
- **Auth mode**: `sf org list auth --json` → `rcg-dms`

## 13. Emergency: VM won't respond

```bash
# Reset (reboot)
gcloud compute instances reset dmsfa-server --zone=us-central1-a

# Wait 60s, then SSH + restart app
sleep 60
gcloud compute ssh dmsfa-server --zone=us-central1-a
# (inside VM)
sudo pm2 start /opt/dmsfa/dist/server.js --name dmsfa --cwd /opt/dmsfa --time
nohup ngrok http 3001 --log=stdout > /tmp/ngrok.log 2>&1 &
```

## 14. One-liner deploy from local

```bash
cd C:\Users\namit\Documents\DMSFA
git add -A; git commit -m "fix: whatever"; git push origin master
gcloud compute ssh dmsfa-server --zone=us-central1-a --command "cd /opt/dmsfa && git pull origin master && npm run build && sudo pm2 restart dmsfa --update-env && sleep 4 && curl -s http://localhost:3000/"
```

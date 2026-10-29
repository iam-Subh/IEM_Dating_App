# Launching the backend on AWS (t4g.small)

The whole backend on one server: the API (with its background jobs), PostgreSQL,
Redis and the face service, from `deploy/docker-compose.prod.yml`. Photos and
videos stay on Cloudflare R2. Fits the AWS free plan's $100 credit:

| Period | Cost |
|---|---|
| Until 31 Dec 2026 | ~$6 a month: the t4g.small server is free (AWS trial); the 30 GB disk and public IP are not |
| Jan to Apr 2027 | ~$14 a month, the server included |

About $70 in total until the free plan ends on 29 Apr 2027.

> **Before 29 Apr 2027 the account must move to the Paid plan** (Billing → Upgrade
> plan), or AWS closes it and the app goes down with it. Unused credit carries over.
> Set a phone reminder for March 2027.

## 1. Launch the server (AWS console)

Region **Asia Pacific (Mumbai) ap-south-1** first (top right).

1. **EC2 → Launch instance**
   - Name: `iem-server`
   - Image: **Ubuntu Server 24.04 LTS**, architecture **64-bit (Arm)**
   - Instance type: **t4g.small**
   - Key pair: **Create new key pair** → `iem-aws`, RSA, `.pem`. Save it to
     `C:\Users\<you>\.ssh\iem-aws.pem`. It is downloaded only once.
   - Network settings → **Edit**:
     - Allow SSH from **My IP** only
     - Allow **HTTPS** and **HTTP** from the internet (only for the free DuckDNS route below)
   - Storage: **30 GiB gp3**
2. **Launch**. Copy the instance's **Public IPv4 address**.
3. **Elastic IP** (so the address never changes): EC2 → Elastic IPs → Allocate →
   Associate with `iem-server`. Free while the server is running.

On Windows, lock the key file once (PowerShell):

```powershell
icacls "$HOME\.ssh\iem-aws.pem" /inheritance:r /grant:r "$($env:USERNAME):R"
ssh -i $HOME\.ssh\iem-aws.pem ubuntu@<ELASTIC_IP>
```

## 2. Prepare the server

```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
# 4 GB of swap: 2 GB of memory is tight with the face models loaded.
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf && sudo sysctl --system
sudo timedatectl set-timezone Asia/Kolkata
exit
```

Log in again (so Docker works without sudo).

## 3. Get the code

The repository is private: give the server a read-only deploy key.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github -N ''
cat ~/.ssh/github.pub
```

GitHub → the repository → **Settings → Deploy keys → Add deploy key**: paste it,
leave **Allow write access** off.

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/github\n' >> ~/.ssh/config
git clone git@github.com:iam-Subh/IEM_Dating_App.git ~/iem
cd ~/iem
```

Only what is committed and pushed reaches the server.

## 4. Settings

```bash
cp deploy/.env.example deploy/.env
cp deploy/api.env.example deploy/api.env
nano deploy/.env        # POSTGRES_PASSWORD, API_DOMAIN, backup bucket
nano deploy/api.env     # the API's secrets
chmod 600 deploy/.env deploy/api.env
```

- Make every secret new: `openssl rand -hex 32`. Never reuse the local ones.
- Both files are git-ignored. Never commit them or paste them anywhere.

## 5. An https address for the API

**Free: DuckDNS + Caddy** (`--profile duckdns`)

1. Sign in at duckdns.org, add a name (for example `iemconnect`), and set its IP
   to the server's Elastic IP.
2. In `deploy/.env`: `API_DOMAIN=iemconnect.duckdns.org`
3. In `deploy/api.env`: `PUBLIC_WEB_URL=https://iemconnect.duckdns.org`

Caddy gets and renews the https certificate by itself.

**With your own domain on Cloudflare** (`--profile tunnel`): Cloudflare Zero
Trust → Networks → Tunnels → create one, route a hostname to `http://api:3000`,
put its token in `TUNNEL_TOKEN`, and close ports 80 and 443 in the security group.

## 6. Start

```bash
docker compose -f deploy/docker-compose.prod.yml --profile duckdns up -d --build
docker compose -f deploy/docker-compose.prod.yml logs -f api
```

The first build takes a while on 2 CPUs. The API runs its database migrations
(`prisma migrate deploy`) every start; the colleges and campuses come with them.

Check: `curl https://iemconnect.duckdns.org/health`

Point the app at it: the mobile app's API address becomes `https://<API_DOMAIN>/api/v1`.

## 7. Nightly backup

```bash
crontab -e
# add:
30 3 * * * cd ~/iem && sh deploy/backup.sh >> ~/iem-backup.log 2>&1
```

Run `sh deploy/backup.sh` once by hand first and check the file arrives in R2.

## 8. Production: before launch day

Each of these is about protecting real people's data and keeping the app up
without someone watching it.

**Security updates install themselves** (the server, not the app):

```bash
sudo apt install -y unattended-upgrades && sudo dpkg-reconfigure -f noninteractive unattended-upgrades
```

**SSH only from your own IP.** EC2 → Security groups → the server's group:
SSH (22) from *My IP* only. Re-set it when your home IP changes. Never `0.0.0.0/0`.

**The server recovers itself.** EC2 → the instance → Actions → Monitor and
troubleshoot → *Manage auto-recovery*: on. And a CloudWatch alarm:
CloudWatch → Alarms → Create → EC2 → *StatusCheckFailed_System* for `iem-server`,
≥ 1 for 2 periods → action **Recover this instance** (and email you).

**Disk snapshots every day** (a second copy, besides the database backup):
EC2 → Lifecycle Manager → Create policy → target the server's volume (tag it
`backup=daily`), every 24 h, keep 7. About $0.50 a month.

**Someone watches from outside.** A free uptime monitor (UptimeRobot or
Better Stack): check `https://<API_DOMAIN>/health` every 5 minutes, alert by
email and phone. Add a second check for the backup: healthchecks.io's free
plan, pinged from the end of `deploy/backup.sh` (add
`curl -fsS https://hc-ping.com/<your-id> >/dev/null` as its last line), so a
night without a backup emails you.

**Restore once, before launch.** A backup nobody has restored is a hope:

```bash
sh deploy/backup.sh
sh deploy/restore.sh ~/iem-backups/<newest file>.sql.gz   # type RESTORE
```

Then open the app and check the data is there. Do it before real users exist.

**Restarting by itself.** Every service restarts if it stops, and `autoheal`
restarts one whose health check keeps failing (an API that hangs). Logs are
capped so they never fill the disk.

**When it outgrows 2 GB.** Watch EC2 → Monitoring (CPU) and on the server
`free -m` / `docker stats --no-stream`. If memory stays in swap or CPU credits
run out: stop the server, Actions → Instance settings → Change instance type →
**t4g.medium** (4 GB, about twice the price), start. Nothing else changes.

**Photos without a domain yet: CloudFront.** Until there is a domain, put AWS's
CDN in front of the R2 bucket: no domain needed, 1 TB a month in AWS's
always-free allowance, and photos are served from copies near the user, so
R2's rate-limited `r2.dev` address is hardly touched.

1. CloudFront → Create distribution.
2. Origin domain: the R2 public bucket's `xxxx.r2.dev` (from `R2_PUBLIC_URL`),
   protocol **HTTPS only**.
3. Viewer protocol: Redirect HTTP to HTTPS. Cache policy: CachingOptimized.
   WAF: do not enable (it is paid).
4. Create, then set `R2_PUBLIC_URL` and `CDN_URL` in `deploy/api.env` to
   `https://xxxx.cloudfront.net` and restart the API.

The app stores each photo's full address, so moving to your own domain later
means a one-time update of the stored addresses as well as these two settings.

**Photos need your own domain in production.** `R2_PUBLIC_URL` is an `r2.dev`
address today; Cloudflare keeps those for development and rate-limits them,
so with real users photos can fail to load. Connect the public bucket to a
domain: Cloudflare → R2 → the public bucket → Settings → Custom domains →
`media.<your-domain>`, then set `R2_PUBLIC_URL` and `CDN_URL` to
`https://media.<your-domain>` in `deploy/api.env` (CDN_URL still points at an
old CloudFront). The same domain can carry the API (`api.<your-domain>`,
`--profile tunnel`) instead of DuckDNS.

**The app build.** A release build will not start without its API address
(`services/api.ts`). Once the address works, give the production build profile
its address and build:

```bash
cd apps/mobile
eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://<API_DOMAIN>/api/v1 --visibility plaintext
eas build --platform android --profile production
```

## Restore from R2

When the server itself is lost: launch a new one (sections 1 to 6), then copy
the newest backup down from R2 and restore it:

```bash
. deploy/.env && mkdir -p ~/iem-backups && docker run --rm -v ~/iem-backups:/backups   -e AWS_ACCESS_KEY_ID="$BACKUP_R2_ACCESS_KEY_ID" -e AWS_SECRET_ACCESS_KEY="$BACKUP_R2_SECRET_ACCESS_KEY"   -e AWS_DEFAULT_REGION=auto amazon/aws-cli s3 cp "s3://$BACKUP_R2_BUCKET/db/<file>.sql.gz" /backups/   --endpoint-url "https://$BACKUP_R2_ACCOUNT_ID.r2.cloudflarestorage.com"
sh deploy/restore.sh ~/iem-backups/<file>.sql.gz
```

## Updating

```bash
cd ~/iem && git pull
docker compose -f deploy/docker-compose.prod.yml --profile duckdns up -d --build
```

## Keeping the $100

- **Billing → Budgets**: a zero-spend budget emails you on the first cent.
- Stop the server when nobody is testing for a long time: EC2 → Stop. A stopped
  server costs nothing except its disk (~$2.50 a month).
- Never pick a bigger instance type or add disks without checking the price.

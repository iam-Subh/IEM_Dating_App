# Launching the backend on AWS (t4g.small)

The whole backend on one server: the API (with its background jobs), PostgreSQL,
Redis and the face service, from `deploy/docker-compose.prod.yml`. Photos and
videos stay on Cloudflare R2. Fits the AWS free plan's $100 credit:

| Period | Cost |
|---|---|
| Until 31 Dec 2026 | ~$6 a month: the t4g.small server is free (AWS trial); the 30 GB disk and public IP are not |
| Jan to Apr 2027 | ~$14 a month, the server included |

About $70 in total until the free plan ends on 29 Apr 2027.

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
git clone git@github.com:Subhankar-Patra1/IEM_Dating_App.git ~/iem
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

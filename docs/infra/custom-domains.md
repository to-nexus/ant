# Custom Domains (deploy-only) — Infra Guide

> Ops/manifest reference for the infra team. For the architecture, the enable
> switch, and the developer-facing steps, see
> [`docs/internals/42-custom-domains.md`](../internals/42-custom-domains.md).

Lets a user attach a domain they **own** (e.g. `app.mycompany.com`) to an ANT
**deploy** so it is served at their domain over HTTPS. Preview is out of scope.

This builds on **subdomain routing** (already live: deploys serve at
`{label}.ant-deploy.cross.nexus`). Our own wildcard `*.ant-deploy.cross.nexus`
stays on the existing ALB + ACM. Only **user-owned domains** — whose certs we
cannot pre-provision — need the new layer described here.

## Why a new layer (NLB + Caddy)

AWS ALB terminates TLS only with **pre-registered** ACM certs. A user's
`app.mycompany.com` is not ours and appears at an unknown time, so its cert must
be issued **on demand** at first request. That requires an ACME client that
terminates TLS itself:

- **NLB (L4)** — passes `:443` TCP through untouched (no TLS termination), plus
  `:80` for the HTTP-01 challenge. Give it a **static EIP per AZ** so apex
  domains can use A records. This is the target users point their DNS at.
- **Caddy** — reverse proxy with automatic HTTPS. On an unknown SNI it pauses
  the handshake, calls ANT's `GET /internal/tls-ask?domain=<host>`, and issues a
  Let's Encrypt cert only if ANT answers `200` (the abuse gate). Then it
  proxies to `ant-preview`, forwarding the original host as `X-Forwarded-Host`.

DNS-01 is unusable here (it needs the user's DNS API); HTTP-01 / TLS-ALPN-01
work with just the user's CNAME/A record pointing at us.

```
user domain ──(CNAME→ant-domains.cross.nexus | apex A→NLB EIP)──▶ NLB(:80/:443)
   └▶ Caddy (on-demand TLS; ask ant-preview:8080/internal/tls-ask)
        └▶ ant-preview (Host-routed via custom-domain registry → deploy)
# existing {label}.ant-deploy.cross.nexus keeps its ALB + wildcard ACM path.
```

## One-time infra setup

1. **NLB** with a static EIP per AZ, listeners `:80` and `:443` (TCP), targeting
   the Caddy service.
2. **Caddy Deployment + Service** (manifest below). Certificate storage MUST be
   shared across replicas — use the `caddy-storage-redis` module against the
   existing ElastiCache, else replicas double-issue and hit Let's Encrypt limits.
3. **Route53**: `ant-domains.cross.nexus` → NLB (the CNAME target users point at).
4. **ant-preview env**: set `ANT_CUSTOM_DOMAIN_CNAME_TARGET`,
   `ANT_CUSTOM_DOMAIN_APEX_IPS`, `ANT_TLS_ASK_SECRET` (see `.env.example.cloud`).
5. **NetworkPolicy**: `/internal/tls-ask` reachable only from Caddy.

After this, there is **no per-user infra work** — issuance and routing are automatic.

## What the user does (per domain)

1. In the deploy panel, "Add custom domain" → enter hostname + pick package.
2. Create the two DNS records ANT shows:
   - TXT `_ant-challenge.<hostname>` = `<token>` (ownership proof)
   - CNAME `<hostname>` → `ant-domains.cross.nexus` (apex: A record → NLB EIPs)
3. Click Verify. Once active, the first HTTPS hit triggers automatic cert issuance.

## Reference Caddyfile

```caddyfile
{
	# On-demand TLS: only issue for domains ANT approves.
	on_demand_tls {
		ask http://ant-preview:8080/internal/tls-ask
		# If ANT_TLS_ASK_SECRET is set, add it as a header via a small sidecar or
		# Caddy's `header_up` on the ask request (Caddy 2.8+ supports ask headers).
	}
	# Shared cert storage across replicas (required for HA).
	storage redis {
		host        <elasticache-host>
		port        6379
		key_prefix  caddy_tls
	}
}

# Catch-all site: any host with on-demand TLS, proxied to ant-preview.
https:// {
	tls {
		on_demand
	}
	reverse_proxy ant-preview:8080 {
		header_up X-Forwarded-Host {host}
		header_up X-Forwarded-Proto https
	}
}
```

## Reference K8s manifest (Caddy)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: ant-caddy, namespace: ant }
spec:
  replicas: 2
  selector: { matchLabels: { app: ant-caddy } }
  template:
    metadata: { labels: { app: ant-caddy } }
    spec:
      containers:
        - name: caddy
          image: caddy:2  # build a custom image with the caddy-storage-redis module
          ports: [{ containerPort: 80 }, { containerPort: 443 }]
          volumeMounts:
            - { name: caddyfile, mountPath: /etc/caddy }
      volumes:
        - name: caddyfile
          configMap: { name: ant-caddy-config }
---
apiVersion: v1
kind: Service
metadata:
  name: ant-caddy
  namespace: ant
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-type: external
    service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: ip
    service.beta.kubernetes.io/aws-load-balancer-scheme: internet-facing
    service.beta.kubernetes.io/aws-load-balancer-eip-allocations: <eipalloc-a>,<eipalloc-b>
spec:
  type: LoadBalancer
  selector: { app: ant-caddy }
  ports:
    - { name: http, port: 80, targetPort: 80 }
    - { name: https, port: 443, targetPort: 443 }
```

## Notes / limits

- **Let's Encrypt rate limits**: 50 certs/registered-domain/7d, 300 orders/acct/3h.
  The `tls-ask` gate (active-only) prevents random domains from burning quota.
  Validate against LE **staging** before switching to production ACME.
- **User wildcard domains** (`*.mycompany.com`) need DNS-01 → not supported; use
  a concrete hostname per app (on-demand issues unlimited concrete hostnames).
- **Apex** needs the NLB static EIPs (A record); CNAME is subdomain-only.
- **Managed alternative**: Cloudflare for SaaS (Custom Hostnames API) replaces
  the NLB+Caddy layer entirely — trade infra ops for vendor cost/lock-in.

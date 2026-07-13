# Cloud deployment

This page has been merged. The operator-friendly cloud setup now lives at:

- **Cloud mode — install**: [../cloud-mode/install.md](../cloud-mode/install.md)
  — covers both managed (Persona B, `ant.crosstoken.io`) and self-host
  (Persona C, single-VM or multi-tenant Kubernetes).

Provider-specific runbooks (IAM, Helm values, CSI drivers, autoscaling) are
part of your own deployment infrastructure and are not shipped with the OSS
tree — the install page above is the vendor-neutral SSOT.

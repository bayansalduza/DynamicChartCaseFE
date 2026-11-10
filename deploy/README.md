# CI/CD

`main` push runs frontend checks, the regression suite and production container smoke tests. Pull requests run checks without deploying. In **Actions → CI and production deployment → Run workflow**, select `main`; disable `deploy` for CI only.

Successful releases produce `dynamicchart-fe:sha-<commit>`, upload a one-day artifact and request the `production-dynamicchart-fe` environment deployment. The job waits for Ubuntu's health result and fails on a rollout error or offline agent. Environment protection rules apply before the release job starts.

The outbound-only Ubuntu deployment agent is maintained in [MyCMS](https://github.com/bayansalduza/MyCMS/blob/master/docs/cicd.tr.md). It must be installed once. It updates only the FE service, preserving the API, Caddy, networks and persistent data; unhealthy releases revert to the previous image. No production GitHub runner or incoming port is required.

The unprivileged Nginx image serves port 8080 and `/healthz`. The image sets the existing API URL to `https://dynamic-chart-api.bakibayansalduz.com`; the local development source retains its localhost default. The base image comes from Nginx's official GHCR mirror, avoiding anonymous Docker Hub pull quotas.

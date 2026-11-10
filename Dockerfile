FROM ghcr.io/nginx/nginx-unprivileged:1.30.6-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY css/ /usr/share/nginx/html/css/
COPY js/ /usr/share/nginx/html/js/
USER root
RUN sed -i 's|https://localhost:44344|https://dynamic-chart-api.bakibayansalduz.com|g' \
    /usr/share/nginx/html/index.html
USER 101
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

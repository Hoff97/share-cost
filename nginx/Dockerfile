FROM nginx:1-alpine

# Install certbot
RUN apk add --no-cache certbot certbot-nginx

# Create webroot for ACME challenges
RUN mkdir -p /var/www/certbot

# Copy nginx configs
COPY nginx.conf      /etc/nginx/nginx.conf
COPY nginx-init.conf /etc/nginx/nginx-init.conf
COPY entrypoint.sh   /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80 443

ENTRYPOINT ["/entrypoint.sh"]

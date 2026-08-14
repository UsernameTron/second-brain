# hubspot-mcp-bridge — IAM-gated Streamable-HTTP front for @hubspot/mcp-server
FROM node:22-slim
# ponytail: version pinned; a bump is a deliberate commit, not a redeploy surprise
RUN npm install -g @hubspot/mcp-server@0.4.0
WORKDIR /app
COPY server.js .
ENV NODE_ENV=production
CMD ["node", "server.js"]

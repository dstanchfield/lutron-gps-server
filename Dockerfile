# Use the Node.js 18.16.1 Alpine image.
FROM node:18.16.1-alpine

# Create and change to the app directory.
WORKDIR /usr/src/app

# Copy application dependency manifests to the container image.
COPY package*.json ./

# Install production dependencies.
RUN npm install --only=production

# Copy local code to the container image.
COPY . .

# Bind to port 23232 for UDP traffic
EXPOSE 23232/udp

# Run the web service on container startup.
CMD [ "node", "src/index.js" ]
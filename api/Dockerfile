FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript (remove stale dist/ that may come from COPY)
RUN rm -rf dist && npm run build

EXPOSE 4000

CMD ["npm", "start"]

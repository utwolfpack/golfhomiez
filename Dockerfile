FROM node:22-bookworm-slim

WORKDIR /app

# Runtime video rendering for the current-events commercial scheduled job.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY .npmrc ./

# Install deps without running postinstall yet, because the source files
# have not been copied at this stage.
RUN npm ci --include=dev --ignore-scripts || npm install --ignore-scripts

COPY . .

RUN npm run build

CMD ["npm", "start"]

FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
COPY .npmrc ./

# Install deps without running postinstall yet, because the source files
# have not been copied at this stage.
RUN npm ci --include=dev --ignore-scripts || npm install --ignore-scripts

COPY . .

RUN npm run build

EXPOSE 5001

CMD ["npm", "start"]

# Next.js frontend for IncidentPilot.
#
# The API base URL is baked at build time via NEXT_PUBLIC_API_URL. For a local
# judge run the published backend port (localhost:8000) is what the browser
# talks to, so that is the default here.
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]
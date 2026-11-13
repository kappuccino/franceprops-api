FROM node:26-alpine

WORKDIR /app

# poppler: PDF tools. sharp ships its own prebuilt libvips, no system vips needed
RUN apk add --no-cache poppler-data poppler-utils

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 8000

ENV PORT=8000

CMD [ "npm", "start" ]

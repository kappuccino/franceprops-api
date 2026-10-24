FROM node:26-alpine
#FROM node:20-bookworm

# Create app directory
WORKDIR /app

#ENV npm_config_sharp_libvips_binary_host

RUN apk add --upgrade --no-cache \
    vips-dev build-base fftw-dev gcc g++ make libc6-compat poppler-data poppler-utils ffmpeg \
    #--repository https://dl-3.alpinelinux.org/alpine/edge/community/ \
    #--repository https://dl-3.alpinelinux.org/alpine/v3.20/community/ \
    --repository https://dl-cdn.alpinelinux.org/alpine/v3.20/community/
	#--repository https://alpine.global.ssl.fastly.net/alpine/v3.18/community/

#RUN apt-get --upgrade  \
#    vips-dev libc6-compat poppler-data poppler-utils

#RUN apt-get install -y libvips-dev

# If you are building your code for production
COPY package*.json ./
RUN npm ci

# Bundle app source
COPY . .

EXPOSE 8000

ENV PORT=8000

CMD [ "npm", "start" ]

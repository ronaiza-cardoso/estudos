FROM node:22-alpine

# O Alpine não vem com dados de fuso horário: sem isto a variável TZ é
# ignorada, o container fica em UTC e as sessões da noite caem no dia seguinte.
RUN apk add --no-cache tzdata

WORKDIR /app

# Instala as dependências primeiro para aproveitar o cache do Docker.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY . .

# O front é compilado e servido pelo próprio Fastify.
RUN npm run build --workspace web

EXPOSE 5183

CMD ["npm", "run", "start", "--workspace", "server"]

FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

COPY package.json server.js index.html manus-routes.json ./

EXPOSE 3000
CMD ["node", "server.js"]

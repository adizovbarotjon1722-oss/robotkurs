# Qumri: Railway (yoki istalgan Docker server) uchun. npm paketlari kerak emas.
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production TRUST_PROXY=1
# Railway PORT ni o'zi beradi; bazani Volume ichida saqlang: DB_PATH=/data/qumri.db
CMD ["node", "server/server.js"]

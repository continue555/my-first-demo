# ===== Stage 1: 构建前端 =====
FROM node:20-alpine AS frontend

WORKDIR /app
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

COPY frontend/ ./frontend/
COPY shared/ ./shared/
RUN cd frontend && npm run build

# ===== Stage 2: 运行后端 =====
FROM node:20-alpine

WORKDIR /app

# 安装生产依赖
COPY package*.json ./
RUN npm ci --production && npm cache clean --force

# 复制后端代码
COPY server.js database.js ecosystem.config.js ./
COPY routes/ ./routes/
COPY middleware/ ./middleware/
COPY shared/ ./shared/

# 复制构建好的前端
COPY --from=frontend /app/public/ ./public/

# 创建 uploads 目录
RUN mkdir -p uploads

EXPOSE 3000

# 使用 PM2 或直接 node 启动
CMD ["node", "server.js"]

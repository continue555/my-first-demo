#!/bin/bash
# 吹瓶机管理系统 - 一键部署脚本
# 在服务器上执行: bash deploy.sh

set -e

APP_DIR="/opt/blowing-machine"
echo "========================================="
echo "  吹瓶机管理系统 - 部署脚本"
echo "========================================="

# 1. 创建目录
echo "[1/6] 创建应用目录..."
mkdir -p $APP_DIR/logs
mkdir -p $APP_DIR/backups

# 2. 复制文件（假设代码已在当前目录）
echo "[2/6] 复制项目文件..."
# 先清理旧静态资源，避免旧 hash 文件堆积；.env、uploads、logs、backups 都不受影响
if [ -d ./public/assets ]; then
  rm -rf $APP_DIR/public/assets
fi
cp -r ./* $APP_DIR/ 2>/dev/null || true
cd $APP_DIR

# 3. 安装依赖
echo "[3/6] 安装依赖..."
npm install --production

# 4. 检查 .env 文件
if [ ! -f .env ]; then
    echo "[!] 请先创建 .env 文件："
    echo "    cp .env.example .env"
    echo "    nano .env  # 编辑 JWT_SECRET 等配置"
    exit 1
fi

# 5. 配置 Nginx
echo "[5/6] 配置 Nginx..."
if [ -f deploy/nginx.conf ]; then
    sudo cp deploy/nginx.conf /etc/nginx/sites-available/blowing-machine
    sudo ln -sf /etc/nginx/sites-available/blowing-machine /etc/nginx/sites-enabled/
    sudo nginx -t && sudo systemctl reload nginx
    echo "  Nginx 配置完成"
else
    echo "  [!] 未找到 nginx.conf，跳过"
fi

# 6. 启动/重启 PM2
echo "[6/6] 启动 PM2..."
if command -v pm2 &> /dev/null; then
    pm2 delete blowing-machine 2>/dev/null || true
    pm2 start ecosystem.config.js
    pm2 save
    pm2 startup | grep "sudo" | bash 2>/dev/null || true
    echo "  PM2 已启动"
else
    echo "  [!] PM2 未安装，请先安装: npm install -g pm2"
    exit 1
fi

echo ""
echo "========================================="
echo "  部署完成！"
echo "  访问地址: http://$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_IP')"
echo "  PM2 状态: pm2 status"
echo "  查看日志: pm2 logs blowing-machine"
echo "========================================="

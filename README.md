# WebDAV-S3 Gateway

[![Deploy to Cloudflare Pages](https://deploy.workers.cloudflare.com/deploy-to-pages.svg)](https://deploy.workers.cloudflare.com/?url=https://github.com/Starhes/webdav-s3)
![License](https://img.shields.io/github/license/Starhes/webdav-s3)

**S3-compatible API Gateway for WebDAV storage using Cloudflare Pages Functions.**

使用 Cloudflare Pages Functions 将 WebDAV 存储转换为 S3 兼容 API。让你可以使用 AWS CLI、s3cmd 等标准 S3 工具直接通过 Cloudflare 边缘网络访问你的 WebDAV 服务。

## 功能

- ✅ AWS Signature V4 认证
- ✅ GetObject (下载文件)
- ✅ PutObject (上传文件)
- ✅ DeleteObject (删除文件)
- ✅ HeadObject (获取文件元数据)
- ✅ ListBucket (列出文件)
- ✅ HeadBucket (检查存储桶)
- ✅ GetObjectStream (流式下载大文件)
- ✅ Presigned URL (生成预签名分享链接)

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.dev.vars.example` 到 `.dev.vars` 并填入你的配置：

```bash
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars`:

```
WEBDAV_URL=https://your-webdav-server.com/dav/
WEBDAV_USERNAME=your-username
WEBDAV_PASSWORD=your-password
S3_ACCESS_KEY_ID=your-custom-access-key
S3_SECRET_ACCESS_KEY=your-custom-secret-key
S3_REGION=us-east-1
```

### 3. 本地开发

```bash
npm run dev
```

### 4. 部署到 Cloudflare (CLI 方式)

```bash
npm run deploy
```

在 Cloudflare Dashboard 中设置环境变量 (Settings > Environment variables)。

## ☁️ 完全在线部署 (无需本地操作)

如果你不想使用命令行，可以直接在 Cloudflare Dashboard 上操作：

1. **Fork 本仓库** 到你的 GitHub 账号。
2. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，进入 **Compute (Workers & Pages)** > **Pages**。
3. 点击 **Connect to Git**，选择你 Fork 的 `webdav-s3` 仓库。
4. **配置构建设置 (Build settings)**:
   - **Framework preset**: `None`
   - **Build command**: _(留空或填 `npm run build`)_
   - **Build output directory**: `public`
5. **设置环境变量 (Environment variables)**:
   - 点击 "Environment variables (advanced)" 展开
   - 添加以下变量：
     - `WEBDAV_URL`: 你的 WebDAV 地址 (例如: `https://dav.jianguoyun.com/dav/`)
     - `WEBDAV_USERNAME`: WebDAV 用户名
     - `WEBDAV_PASSWORD`: WebDAV 密码
     - `S3_ACCESS_KEY_ID`: 自行设置一个 Access Key ID (例如: `my-access-key`)
     - `S3_SECRET_ACCESS_KEY`: 自行设置一个 Secret Key (例如: `my-secret-key`)
     - `S3_REGION`: `us-east-1` (或你喜欢的区域代码)
6. 点击 **Save and Deploy**。

> ⚠️ **注意**: 不要设置 Deploy command！Cloudflare Pages 会自动识别 `functions/` 目录并部署 Functions。

部署完成后，你会获得一个 `*.pages.dev` 的域名，这就是你的 S3 API Endpoint。

## 使用方法

### 配置 AWS CLI

```bash
aws configure
# Access Key ID: 你设置的 S3_ACCESS_KEY_ID
# Secret Access Key: 你设置的 S3_SECRET_ACCESS_KEY
# Region: 你设置的 S3_REGION
```

### 常用命令

```bash
# 设置 endpoint
ENDPOINT="https://your-project.pages.dev"

# 上传文件
aws s3 cp test.txt s3://bucket/test.txt --endpoint-url $ENDPOINT

# 下载文件
aws s3 cp s3://bucket/test.txt ./downloaded.txt --endpoint-url $ENDPOINT

# 列出文件
aws s3 ls s3://bucket/ --endpoint-url $ENDPOINT

# 删除文件
aws s3 rm s3://bucket/test.txt --endpoint-url $ENDPOINT
```

> **目录映射**: Bucket 名称会自动映射为 WebDAV 目录。例如 `s3://photos/image.jpg` 会映射到 WebDAV 的 `/photos/image.jpg`。

## 项目结构

```
webdav-s3/
├── functions/
│   └── [[path]].ts          # Pages Functions 入口 (边缘计算)
├── src/
│   ├── s3/
│   │   ├── signature.ts     # AWS Sig V4 签名验证
│   │   ├── operations.ts    # S3 操作实现
│   │   ├── presign.ts       # 预签名 URL 生成
│   │   └── xml.ts           # S3 XML 响应
│   ├── webdav/
│   │   ├── client.ts        # WebDAV 客户端
│   │   └── parser.ts        # XML 解析
│   ├── config.ts            # 配置验证
│   └── types.ts             # 类型定义
├── public/
│   └── index.html           # 落地页
├── package.json
├── tsconfig.json
└── wrangler.toml
```

## 架构说明

本项目部署在 **Cloudflare Pages** 上，利用 **Pages Functions** 实现边缘计算：

```
用户请求 → Cloudflare 边缘节点 → Pages Functions → WebDAV 服务器
              ↓
         AWS Signature V4 认证
              ↓
         S3 API 转换为 WebDAV
```

**优势**：
- 全球分布式边缘节点，低延迟访问
- 免费额度包含每月 100,000 次请求
- 自动缩放，无需服务器管理
- 支持 AWS Signature V4 签名认证

## 预签名 URL (分享文件)

生成临时分享链接，有效期默认 24 小时：

```bash
# 生成预签名 URL (需要实现 API 端点)
ENDPOINT="https://your-project.pages.dev"

# 使用 presigned URL 直接下载文件
curl -o file.txt "https://your-project.pages.dev/bucket/file.txt?X-Amz-Expires=86400&..."
```

## 限制

- 不支持分片上传 (Multipart Upload)
- 单次请求最大 100MB (免费版) / 500MB (付费版)
- 请求执行时间限制 30 秒
- 预签名 URL 需要额外配置才能公开访问

## 常见问题 (Troubleshooting)

### 404 Not Found / Method Not Allowed

如果你在使用 Memos 或其他 S3 客户端时遇到 `404 Not Found` 错误，通常是因为客户端使用了 **Virtual-Hosted Style** (例如 `https://bucket-name.pages.dev/key`) 访问 API。

Cloudflare Pages 默认不支持子域名通配符。你需要配置客户端使用 **Path-Style** (例如 `https://pages.dev/bucket-name/key`)。

**解决方法**:
- 在客户端设置中开启 `Force Path Style` (强制路径模式) 或类似选项。
- 确保 Endpoint 填写的是 `https://your-project.pages.dev` 而不是包含 bucket 的域名。

## License

MIT

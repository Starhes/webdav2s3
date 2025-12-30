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

### 4. 部署到 Cloudflare

```bash
npm run deploy
```

在 Cloudflare Dashboard 中设置环境变量 (Settings > Environment variables)。

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

> **注意**: bucket 名称会被忽略，所有操作都映射到 WebDAV 根目录。

## 项目结构

```
webdav-s3/
├── functions/
│   └── [[path]].ts          # Pages Functions 入口
├── src/
│   ├── s3/
│   │   ├── signature.ts     # AWS Sig V4 验证
│   │   ├── operations.ts    # S3 操作实现
│   │   └── xml.ts           # S3 XML 响应
│   ├── webdav/
│   │   ├── client.ts        # WebDAV 客户端
│   │   └── parser.ts        # XML 解析
│   ├── config.ts            # 配置
│   └── types.ts             # 类型定义
├── public/
│   └── index.html           # 落地页
├── package.json
├── tsconfig.json
└── wrangler.toml
```

## 限制

- 不支持分片上传 (Multipart Upload)
- 单次请求最大 100MB (免费版) / 500MB (付费版)
- 请求执行时间限制 30 秒

## License

MIT

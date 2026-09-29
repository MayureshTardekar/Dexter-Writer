# Dexter Write — Serverless LaTeX Compiler (AWS Lambda)

A zero-maintenance, **100% Free Tier ($0.00)** serverless LaTeX compiler backend for Dexter Write using [Tectonic](https://tectonic-typesetting.github.io/) (the modern Rust XeTeX engine).

---

## Why AWS Lambda?
* **Client Download:** **0 MB** (instead of 120 MB / 650 MB WASM).
* **Speed:** ~500ms – 1.2s per compilation.
* **Monthly Cost:** **$0.00** (under AWS permanent 400,000 GB-seconds + 1M free requests/month).
* **Security:** Sandboxed execution (`--untrusted`), no shell escape, auto-cleaned ephemeral `/tmp` scratch directories.

---

## 1. Local Testing (Before Deploying to AWS)

### Option A: Run directly with Node.js
If you have `tectonic` installed on your machine:
```bash
cd lambda
npm start
# Server starts at http://localhost:8080
```

### Option B: Run via Docker locally
```bash
cd lambda
docker build -t dexter-latex-local .
docker run -p 8080:8080 dexter-latex-local
```
Test with curl or PowerShell:
```bash
curl -X POST http://localhost:8080 \
  -H "Content-Type: application/json" \
  -d '{"tex": "\\documentclass{article}\\begin{document}Hello Dexter!\\end{document}"}' \
  --output test.pdf
```

---

## 2. Deploy to AWS Lambda in 3 Steps (100% Free Tier)

### Prerequisites
* [AWS CLI installed & configured](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) (`aws configure`)
* [Docker Desktop](https://www.docker.com/) running

### Step 1: Create an Amazon ECR Repository
Replace `<REGION>` with your preferred AWS region (e.g., `us-east-1` or `ap-south-1`):
```bash
aws ecr create-repository --repository-name dexter-latex-compiler --region us-east-1
```
Note your 12-digit AWS Account ID from the output (or run `aws sts get-caller-identity --query Account --output text`).

### Step 2: Build & Push the Docker Image
```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Build and Tag
docker build -t dexter-latex-compiler ./lambda
docker tag dexter-latex-compiler:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/dexter-latex-compiler:latest

# Push
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/dexter-latex-compiler:latest
```

### Step 3: Create the Lambda Function & Function URL (Zero API Gateway Cost!)
Create an IAM execution role or use an existing basic execution role:
```bash
# 1. Create Lambda Function (1024MB RAM, 30s timeout)
aws lambda create-function \
  --function-name dexter-latex-compiler \
  --package-type Image \
  --code ImageUri=<ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/dexter-latex-compiler:latest \
  --role arn:aws:iam::<ACCOUNT_ID>:role/lambda-basic-execution \
  --memory-size 1024 \
  --timeout 30 \
  --region us-east-1

# 2. Enable Lambda Function URL (Free HTTPS endpoint, no API Gateway fees)
aws lambda create-function-url-config \
  --function-name dexter-latex-compiler \
  --auth-type NONE \
  --cors '{"AllowOrigins": ["*"], "AllowMethods": ["POST", "OPTIONS"], "AllowHeaders": ["Content-Type"]}' \
  --region us-east-1

# 3. Allow Public Invocations for the Function URL
aws lambda add-permission \
  --function-name dexter-latex-compiler \
  --statement-id FunctionURLAllowPublicAccess \
  --action lambda:InvokeFunctionUrl \
  --principal "*" \
  --function-url-auth-type NONE \
  --region us-east-1
```

The CLI will output your public Function URL:
`https://<random-id>.lambda-url.us-east-1.on.aws/`

---

## 3. Connect to Dexter Write Frontend

In the root of your Dexter Write repository, copy `.env.example` to `.env.local` (or `.env`):
```env
VITE_LATEX_LAMBDA_URL=https://<random-id>.lambda-url.us-east-1.on.aws/
```

Restart your Vite dev server (`npm run dev`) or re-build. 
Now, Dexter Write will automatically use your AWS Lambda compiler:
* **0 MB** download for all users.
* Instant Overleaf-grade PDF output.
* If offline or Lambda is unreachable, it seamlessly falls back to the in-browser WASM engine!

# Quick Deploy Script for R2 Edge Function

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "${GREEN}🚀 R2 Edge Function 快速部署脚本${NC}"
echo "=================================="
echo ""

PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
R2_ENDPOINT_VALUE="${R2_ENDPOINT:-}"

# Step 1: Check Supabase CLI
echo "${YELLOW}Step 1/5: 检查 Supabase CLI...${NC}"
if ! command -v supabase &> /dev/null; then
    echo "${RED}❌ Supabase CLI 未安装${NC}"
    echo "请运行: brew install supabase/tap/supabase"
    echo "或: npm install -g supabase"
    exit 1
fi
echo "${GREEN}✅ Supabase CLI 已安装${NC}"
echo ""

# Step 2: Check project link
echo "${YELLOW}Step 2/5: 检查项目链接...${NC}"
if [ -z "$PROJECT_REF" ]; then
    read -p "Supabase Project Ref: " PROJECT_REF
fi

if [ -z "$PROJECT_REF" ]; then
    echo "${RED}❌ 缺少 Supabase Project Ref${NC}"
    echo "请设置 SUPABASE_PROJECT_REF 或在提示时输入"
    exit 1
fi

if [ ! -f "./.supabase/config.toml" ]; then
    echo "${YELLOW}⚠️  项目未链接，开始链接...${NC}"
    supabase link --project-ref "$PROJECT_REF"
else
    echo "${GREEN}✅ 项目已链接${NC}"
fi
echo ""

# Step 3: Set secrets
echo "${YELLOW}Step 3/5: 设置环境变量 (Secrets)...${NC}"
echo "请输入您的 R2 凭证:"
echo ""

read -p "R2 Access Key ID: " R2_ACCESS_KEY
read -p "R2 Secret Access Key: " R2_SECRET_KEY

if [ -z "$R2_ENDPOINT_VALUE" ]; then
    read -p "R2 Endpoint (例如 https://<account-id>.r2.cloudflarestorage.com): " R2_ENDPOINT_VALUE
fi

if [ -z "$R2_ENDPOINT_VALUE" ]; then
    echo "${RED}❌ 缺少 R2 Endpoint${NC}"
    echo "请设置 R2_ENDPOINT 或在提示时输入"
    exit 1
fi

echo ""
echo "${YELLOW}正在设置 secrets...${NC}"
supabase secrets set R2_ENDPOINT="$R2_ENDPOINT_VALUE"
supabase secrets set R2_ACCESS_KEY="$R2_ACCESS_KEY"
supabase secrets set R2_SECRET_KEY="$R2_SECRET_KEY"
echo "${GREEN}✅ Secrets 设置完成${NC}"
echo ""

# Step 4: Deploy function
echo "${YELLOW}Step 4/5: 部署 Edge Function...${NC}"
supabase functions deploy upload-to-r2

if [ $? -eq 0 ]; then
    echo "${GREEN}✅ Edge Function 部署成功！${NC}"
else
    echo "${RED}❌ 部署失败，请检查错误信息${NC}"
    exit 1
fi
echo ""

# Step 5: Verify
echo "${YELLOW}Step 5/5: 验证部署...${NC}"
echo "Edge Function URL:"
echo "https://${PROJECT_REF}.supabase.co/functions/v1/upload-to-r2"
echo ""
echo "${GREEN}✅ 部署完成！${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "${GREEN}🎉 R2 直接上传功能已启用！${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "下一步测试:"
echo "1. 打开 Admin Studio: http://localhost:8000/admin-studio.html"
echo "2. 上传图片并保存"
echo "3. 检查控制台: 应显示 '✅ Successfully uploaded N images to R2 CDN'"
echo ""
echo "查看日志:"
echo "supabase functions logs upload-to-r2 --follow"
echo ""

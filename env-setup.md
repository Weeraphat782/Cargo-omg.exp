# Environment Variables Setup Guide

## สร้างไฟล์ .env.local

ให้สร้างไฟล์ `.env.local` ที่ root directory ของโปรเจ็กต์ และใส่ค่าดังนี้:

```env
# Supabase Configuration
# หา values เหล่านี้ได้จาก Supabase Dashboard > Settings > API

# Client-side (public)
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anonymous-key-here

# Server-side (private) 
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Optional: Cloudflare R2 Configuration
# สำหรับระบบ CMS (Public)
R2_PUBLIC_BUCKET_NAME=omgexp-public-assets
R2_PUBLIC_URL=https://your-public-bucket-url.r2.dev

# สำหรับระบบ Customer Documents (Private)
R2_DOCS_BUCKET_NAME=documents

# R2 Credentials (ใช้ร่วมกัน)
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
```

## วิธีการหาค่า Supabase Keys

1. เข้าไปที่ [Supabase Dashboard](https://app.supabase.com/)
2. เลือกโปรเจ็กต์ของคุณ
3. ไปที่ **Settings** > **API**
4. คัดลอกค่าดังนี้:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL` และ `SUPABASE_URL`
   - **anon public** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** → `SUPABASE_SERVICE_ROLE_KEY`

## หลังจากตั้งค่าแล้ว

1. Restart development server (`npm run dev`)
2. ตรวจสอบว่าไม่มี error "Supabase client not initialized" อีก

## สำคัญ ⚠️

- **อย่า commit** ไฟล์ `.env.local` เข้า Git
- เก็บ `service_role` key ไว้เป็นความลับ
- ใช้ `anon` key สำหรับ client-side เท่านั้น 
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { customerWithoutCompanyResponse } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// Confirms a company-document upload and upserts the record in company_documents table.
export async function POST(request: NextRequest) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 })
  }

  try {
    const {
      filePath,
      userId,
      documentType,
      documentTypeName,
      originalFileName,
      provider,
    } = await request.json()

    if (!filePath || !userId || !documentType || !documentTypeName || !originalFileName) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
    }

    const companyBlock = await customerWithoutCompanyResponse(supabase, userId)
    if (companyBlock) return companyBlock

    const { data, error } = await supabase
      .from('company_documents')
      .upsert(
        {
          user_id: userId,
          document_type: documentType,
          document_type_name: documentTypeName,
          file_path: filePath,
          file_name: originalFileName,
          storage_provider: provider || 'r2',
          uploaded_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,document_type' }
      )
      .select('id')
      .single()

    if (error) {
      console.error('confirm-company-document DB error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, id: data?.id })
  } catch (error) {
    console.error('confirm-company-document error:', error)
    return NextResponse.json({ error: 'Unexpected error.' }, { status: 500 })
  }
}
